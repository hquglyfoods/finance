// netlify/functions/toast-sync.js
// Hourly sync of Toast sales for each store (AD/BW/FH).
//
// Channel mapping (dining option takes priority, to avoid double counting):
//   - Order dining option "Uber Eats*"  -> uber channel
//   - Order dining option "DoorDash*"   -> doordash channel
//   - Order dining option "Grubhub*"    -> grubhub channel
//   - Any other order (Take Out, Online Ordering, Kiosk, dine in, etc.):
//         payment type CASH   -> cash channel
//         everything else     -> card channel
//   Delivery orders are NOT added to card, even though they settle by card,
//   so revenue is never counted twice.
//
// Amounts are TAX-INCLUSIVE (matches the Excel closing board). Sales tax is
// handled as an automatic expense rule in the app, not deducted here.
// Tips are excluded from revenue and booked into the 'tips' expense category.
//
// Business date handling: we pull each store's own business date. "Today" is
// still in progress, so by default we sync the last 2 completed business days
// (yesterday and the day before) for catch-up, plus today's in-progress figure
// flagged so the app can show it as provisional.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   TOAST_CLIENT_ID, TOAST_CLIENT_SECRET
//   TOAST_API_HOST         (default https://ws-api.toasttab.com)
//   TOAST_RESTAURANTS      "AD:guid,BW:guid,FH:guid"

const { createClient } = require('@supabase/supabase-js');
const { captureSnapshot, hasSnapshots, backfillHourlyFromOrders } = require('./lib/snapshots.js');

const HOST = process.env.TOAST_API_HOST || 'https://ws-api.toasttab.com';
const pad = n => String(n).padStart(2, '0');

async function login() {
  const res = await fetch(`${HOST}/authentication/v1/authentication/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: process.env.TOAST_CLIENT_ID,
      clientSecret: process.env.TOAST_CLIENT_SECRET,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  if (!res.ok) throw new Error('Toast login ' + res.status);
  return (await res.json()).token.accessToken;
}

// The list of restaurants our Toast credential can see. This is what makes new
// stores appear automatically: no env editing needed. Returns [{guid, name,
// locationName, deleted, managementGroupGuid}].
async function listRestaurants(token) {
  const res = await fetch(`${HOST}/partners/v1/restaurants`,
    { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new Error('restaurants list ' + res.status);
  const arr = await res.json();
  return (arr || []).map(r => ({
    guid: r.restaurantGuid,
    name: (r.restaurantName || '').trim(),
    locationName: (r.locationName || '').trim(),
    deleted: !!r.deleted,
    managementGroupGuid: r.managementGroupGuid || null,
  }));
}

// Per-restaurant config: timezone, closeout hour, first business date, address.
// Used to set a new store's timezone automatically and to know how far back to
// backfill its history.
async function restaurantConfig(token, guid) {
  const res = await fetch(`${HOST}/restaurants/v1/restaurants/${guid}`,
    { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
  if (!res.ok) throw new Error('restaurant config ' + res.status);
  const b = await res.json();
  const g = (b && b.general) || {};
  const loc = (b && b.location) || {};
  return {
    timeZone: g.timeZone || null,
    closeoutHour: (g.closeoutHour != null ? g.closeoutHour : null),
    firstBusinessDate: g.firstBusinessDate || null, // e.g. 20250327
    name: (g.name || '').trim(),
    locationName: (g.locationName || '').trim(),
    stateCode: loc.stateCode || null,
    managementGroupGuid: g.managementGroupGuid || null,
  };
}

// Our own corporate management group. Stores in this group that we don't already
// have are unusual (we create corporate ones by hand); everything else that is new
// is treated as a franchisee, per the agreed rule "new stores default to franchisee".
const OUR_GROUP = process.env.TOAST_CORPORATE_GROUP || 'a761b9d9-0074-493d-bc8d-47687dbd9847';

// Make a short store code from a location name, e.g. "Forest Hills" -> "FORESTHILLS".
// Falls back to part of the GUID if empty. Ensures uniqueness against existing codes.
function makeCode(name, guid, taken) {
  let base = (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!base) base = 'STORE' + guid.slice(0, 4).toUpperCase();
  let code = base, i = 2;
  while (taken.has(code)) { code = base.slice(0, 10) + i; i++; }
  return code;
}

async function diningNameMap(token, guid) {
  const map = {};
  try {
    const res = await fetch(`${HOST}/config/v2/diningOptions`,
      { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
    if (res.ok) (await res.json() || []).forEach(d => { if (d.guid) map[d.guid] = (d.name || '').toLowerCase(); });
  } catch (e) {}
  return map;
}

async function fetchOrders(token, guid, businessDate) {
  let orders = [], page = 1;
  while (page < 100) {
    const res = await fetch(`${HOST}/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=100&page=${page}`,
      { headers: { Authorization: 'Bearer ' + token, 'Toast-Restaurant-External-ID': guid } });
    if (!res.ok) throw new Error(`orders ${businessDate} ${res.status}`);
    const batch = await res.json();
    orders.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return orders;
}

// classify a single order into a channel code
function channelFor(order, diningNames) {
  let doName = '';
  if (order.diningOption) {
    doName = order.diningOption.name || diningNames[order.diningOption.guid] || '';
  }
  doName = doName.toLowerCase();
  if (doName.includes('uber')) return { delivery: 'uber' };
  if (doName.includes('doordash') || doName.includes('door dash')) return { delivery: 'doordash' };
  if (doName.includes('grubhub') || doName.includes('grub hub')) return { delivery: 'grubhub' };
  // Self online ordering (Toast online ordering / Toast Delivery) is always card-paid but
  // is tracked in its own 'online' channel, separate from in-store card.
  if (doName.includes('online ordering') || doName.includes('online order')) return { delivery: 'online' };
  return { delivery: null }; // in-store: decide by payment type
}

function summarize(orders, diningNames) {
  const sums = { cash: 0, card: 0, uber: 0, grubhub: 0, doordash: 0, online: 0 };
  let tips = 0;
  for (const o of orders) {
    if (o.voided) continue;
    const { delivery } = channelFor(o, diningNames);
    for (const chk of o.checks || []) {
      if (chk.voided || chk.deleted) continue;
      for (const p of chk.payments || []) {
        if (p.paymentStatus === 'VOIDED') continue;
        const amt = Number(p.amount || 0);          // tax-inclusive
        const tip = Number(p.tipAmount || 0);
        tips += tip;
        const net = amt - tip;                       // exclude tip from revenue
        if (delivery) { sums[delivery] += net; continue; }
        if (p.type === 'CASH') sums.cash += net;
        else sums.card += net;                       // CREDIT + OTHER(online) -> card
      }
    }
  }
  for (const k in sums) sums[k] = +sums[k].toFixed(2);
  return { sums, tips: +tips.toFixed(2) };
}

// business date strings for the last N days given a timezone offset in hours
// (ET ~ -4, CT ~ -5). Toast business day rolls at ~4am local.
function bizDates(offsetHours) {
  const now = new Date();
  const local = new Date(now.getTime() + offsetHours * 3600 * 1000);
  const list = [];
  for (let back = 0; back <= 2; back++) {
    const d = new Date(local); d.setDate(d.getDate() - back);
    list.push({
      ymd: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`,
      iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      provisional: back === 0,
    });
  }
  return list;
}

// business dates for an explicit inclusive range [start,end] (YYYY-MM-DD). Used for
// manual backfill; none of these are "provisional".
function rangeDates(startIso, endIso) {
  const list = [];
  const s = new Date(startIso + 'T12:00:00Z'), e = new Date(endIso + 'T12:00:00Z');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    list.push({
      ymd: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
      iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      provisional: false,
    });
  }
  return list;
}

// Rough UTC offset (hours) for the timezones our stores use, honoring US DST.
// Used only to pick which business dates to sync; Toast returns the authoritative
// business date per order, so this just needs to land on the right local day.
function offsetForTz(tz) {
  // DST in effect roughly mid-March to early November (US).
  const now = new Date();
  const m = now.getUTCMonth() + 1;
  const dst = (m > 3 && m < 11) || (m === 3 && now.getUTCDate() >= 8) || (m === 11 && now.getUTCDate() < 1);
  if (tz === 'America/Chicago')  return dst ? -5 : -6;
  if (tz === 'America/Denver')   return dst ? -6 : -7;
  if (tz === 'America/Los_Angeles') return dst ? -7 : -8;
  // default Eastern
  return dst ? -4 : -5;
}

// Seed the standard revenue channels for a newly auto-created store so the sync
// has channels to write into. Mirrors the channel set used by AD/BW/FH.
async function seedChannels(admin, corpId) {
  const defs = [
    ['cash', 'Cash', true, 1, 1],
    ['card', 'Card', true, 1, 2],
    ['uber', 'Uber Eats', true, 1, 3],
    ['grubhub', 'Grubhub', true, 1, 4],
    ['doordash', 'DoorDash', true, 1, 5],
    ['online', 'Online Ordering', true, 1, 6],
    ['other_income', 'Other Income', true, 1, 7],
  ];
  const { data: existing } = await admin.from('revenue_channels').select('code').eq('corporation_id', corpId);
  const have = new Set((existing || []).map(c => c.code));
  const rows = defs.filter(d => !have.has(d[0])).map(d => ({
    corporation_id: corpId, code: d[0], name: d[1],
    counts_in_total: d[2], total_multiplier: d[3], display_order: d[4], active: true,
  }));
  if (rows.length) await admin.from('revenue_channels').insert(rows);
}

exports.handler = async (event) => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } });

  // Optional manual backfill: /.netlify/functions/toast-sync?start=2025-07-01&end=2025-07-06
  // re-pulls that exact date range from Toast (tips included). Without params it runs the
  // normal rolling 3-day sync.
  const qp = (event && event.queryStringParameters) || {};
  const backfill = qp.start && qp.end ? { start: qp.start, end: qp.end } : null;
  // When backfilling, default to TIPS ONLY so we don't overwrite revenue that may have
  // been finalized from the Excel board. Pass &tips_only=0 to also refresh revenue.
  const tipsOnly = backfill && qp.tips_only !== '0';
  // Optional store filter: &only=PEARLAND (comma-separated codes) restricts the run to
  // those stores. Used to backfill a single franchise without touching corporate stores
  // (whose past months may be board-finalized) and to keep the run fast enough to not
  // time out. Case-insensitive.
  const onlyCodes = qp.only ? new Set(qp.only.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)) : null;

  let token;
  try { token = await login(); }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }

  const log = [];

  // ---- Build the store map by AUTO-DISCOVERY from Toast (no env editing needed) ----
  // 1) Start from any explicit env mapping (legacy / override).
  // 2) Then ask Toast which restaurants our credential can see and merge them in,
  //    creating a franchisee corporation for any store we don't have yet, and marking
  //    deleted stores hidden. Each store's timezone comes from its Toast config.
  const map = {};   // code -> guid
  (process.env.TOAST_RESTAURANTS || '').split(',').map(s => s.trim()).filter(Boolean)
    .forEach(p => { const [c, g] = p.split(':'); if (c && g) map[c] = g; });

  // existing corporations, indexed by toast_guid and by code
  const { data: allCorps } = await admin.from('corporations')
    .select('id,code,corp_type,toast_guid,timezone,hidden');
  const byGuid = {}, takenCodes = new Set();
  (allCorps || []).forEach(c => { if (c.toast_guid) byGuid[c.toast_guid] = c; takenCodes.add(c.code); });

  // discover from Toast; if it fails, we still run with whatever env/DB gave us.
  // When a store filter is set (targeted backfill), skip discovery entirely: we don't
  // want to create/hide stores or scan the whole account, just backfill the named ones.
  let discovered = [];
  if (!onlyCodes) {
    try { discovered = await listRestaurants(token); }
    catch (e) { log.push('discover: ' + e.message); }
  } else {
    // build the map straight from the DB for the requested codes
    (allCorps || []).forEach(c => {
      if (onlyCodes.has((c.code || '').toUpperCase()) && c.toast_guid) map[c.code] = c.toast_guid;
    });
  }

  for (const r of discovered) {
    let corp = byGuid[r.guid];
    if (r.deleted) {
      // store removed in Toast -> hide it, don't sync
      if (corp && !corp.hidden) { await admin.from('corporations').update({ hidden: true }).eq('id', corp.id); }
      continue;
    }
    if (!corp) {
      // new store: pull its config for timezone, then create a franchisee corp
      let cfg = {};
      try { cfg = await restaurantConfig(token, r.guid); } catch (e) { log.push(`cfg ${r.guid}: ${e.message}`); }
      const label = r.locationName || cfg.locationName || r.name || 'New Store';
      const code = makeCode(label, r.guid, takenCodes);
      takenCodes.add(code);
      const { data: created, error } = await admin.from('corporations').insert({
        code,
        name: label,
        display_name: label,
        corp_type: 'franchisee',                  // new stores default to franchisee
        toast_guid: r.guid,
        timezone: cfg.timeZone || 'America/New_York',
        closeout_hour: cfg.closeoutHour,
        auto_created: true,
        hidden: false,
      }).select('id,code,corp_type,toast_guid,timezone,hidden').maybeSingle();
      if (error) { log.push(`create ${code}: ${error.message}`); continue; }
      corp = created;
      byGuid[r.guid] = corp;
      log.push(`created franchisee ${code} (${r.guid})`);
      // seed default revenue channels so sync has somewhere to write
      await seedChannels(admin, corp.id);
    } else {
      // known store: make sure it has a timezone (older rows may be null) and unhide
      const patch = {};
      if (!corp.timezone) {
        let cfg = {}; try { cfg = await restaurantConfig(token, r.guid); } catch (e) {}
        if (cfg.timeZone) patch.timezone = cfg.timeZone;
        if (cfg.closeoutHour != null) patch.closeout_hour = cfg.closeoutHour;
      }
      if (corp.hidden) patch.hidden = false;
      if (Object.keys(patch).length) await admin.from('corporations').update(patch).eq('id', corp.id);
    }
    map[corp.code] = r.guid;    // include in this run
  }

  for (const [code, guid] of Object.entries(map)) {
    if (onlyCodes && !onlyCodes.has(code.toUpperCase())) continue;   // targeted backfill
    const { data: corp } = await admin.from('corporations')
      .select('id,corp_type,timezone,hidden').eq('code', code).maybeSingle();
    if (!corp) { log.push(`${code}: no corp`); continue; }
    if (corp.hidden) { continue; } // skip hidden/closed stores
    const isFranchise = corp.corp_type === 'franchisee';
    const { data: chs } = await admin.from('revenue_channels').select('id,code').eq('corporation_id', corp.id);
    const chId = {}; (chs || []).forEach(c => chId[c.code] = c.id);
    // franchisee stores are revenue-only (no tips expense on our books)
    const { data: tipCat } = isFranchise ? { data: null } : await admin.from('expense_categories').select('id')
      .eq('corporation_id', corp.id).eq('code', 'tips').maybeSingle();

    let dn = {};
    try { dn = await diningNameMap(token, guid); } catch (e) {}

    const storeTz = corp.timezone || 'America/New_York';
    const offset = offsetForTz(storeTz);
    const dates = backfill ? rangeDates(backfill.start, backfill.end) : bizDates(offset);
    for (const d of dates) {
      let orders;
      try { orders = await fetchOrders(token, guid, d.ymd); }
      catch (e) { log.push(`${code} ${d.ymd}: ${e.message}`); continue; }
      const { sums, tips } = summarize(orders, dn);

      // Safety: if the dedicated 'online' channel hasn't been created for this store yet,
      // fold online-ordering revenue back into card so nothing is dropped. Once the channel
      // exists, it splits out automatically.
      if (!chId['online'] && sums.online) { sums.card += sums.online; sums.online = 0; }

      // upsert each channel (skip 'manual' rows). Provisional (today) rows are
      // marked source 'toast_live' so the app can show them as in progress.
      // In a tips-only backfill, don't touch revenue at all.
      const src = d.provisional ? 'toast_live' : 'toast';
      if (!tipsOnly) for (const chCode of ['cash', 'card', 'uber', 'grubhub', 'doordash', 'online']) {
        if (!chId[chCode]) continue;
        const amount = sums[chCode] || 0;
        // Manual income can now repeat on the same channel and day (several royalty
        // payments, each with its own note), so this must look ONLY at the row this sync
        // owns. Selecting by source keeps hand-entered rows untouched and keeps the sync
        // to exactly one row per day, which is what daily_revenue_auto_unique enforces.
        const { data: exRows } = await admin.from('daily_revenue').select('id,amount')
          .eq('corporation_id', corp.id).eq('channel_id', chId[chCode]).eq('date', d.iso)
          .in('source', ['toast', 'toast_live']).limit(1);
        const ex = (exRows || [])[0];
        if (!ex && amount === 0) continue;
        if (ex) {
          if (Number(ex.amount) === amount) continue;             // unchanged: no write
          await admin.from('daily_revenue').update({
            amount, source: src, updated_at: new Date().toISOString(),
          }).eq('id', ex.id);
        } else {
          await admin.from('daily_revenue').insert({
            corporation_id: corp.id, channel_id: chId[chCode], date: d.iso,
            amount, source: src, updated_at: new Date().toISOString(),
          });
        }
      }

      // tips -> expense (only for completed days, not the live provisional one,
      // to avoid churn; the final sync of that day books tips). Booked as 'confirmed'
      // because Toast tips are actual, finalized amounts (not something to approve), and
      // the app only counts confirmed expenses.
      if (tipCat && !d.provisional) {
        const { data: ex } = await admin.from('expenses').select('id,source')
          .eq('corporation_id', corp.id).eq('category_id', tipCat.id).eq('date', d.iso)
          .eq('source', 'toast').maybeSingle();
        if (ex) { await admin.from('expenses').update({ amount: tips, status: 'confirmed' }).eq('id', ex.id); }
        else if (tips > 0) {
          await admin.from('expenses').insert({
            corporation_id: corp.id, category_id: tipCat.id, date: d.iso,
            amount: tips, memo: 'Card tips (Toast)', source: 'toast', status: 'confirmed',
          });
        }
      }
      log.push(`${code} ${d.iso}${d.provisional ? ' (live)' : ''}: cash ${sums.cash} card ${sums.card} online ${sums.online} uber ${sums.uber} gh ${sums.grubhub} dd ${sums.doordash} tips ${tips}`);

      // Intraday snapshot for the Home "same time last week" comparison. Only on the
      // live day of a normal run; never during manual backfills. Fail-soft: snapshot
      // problems (e.g. table not created yet) must not break the revenue sync.
      if (d.provisional && !backfill && !tipsOnly) {
        const tz = storeTz;
        try { await captureSnapshot(admin, corp.id, d.iso, tz); }
        catch (e) { log.push(`${code} snapshot: ${e.message}`); }
        // Self-heal: if last week's same day has no hourly snapshots yet (feature just
        // shipped), rebuild them once from that day's Toast order timestamps so the
        // comparison works immediately instead of after a one-week warm-up.
        try {
          const lw = new Date(d.iso + 'T12:00:00Z'); lw.setUTCDate(lw.getUTCDate() - 7);
          const lwIso = `${lw.getUTCFullYear()}-${pad(lw.getUTCMonth() + 1)}-${pad(lw.getUTCDate())}`;
          if (!(await hasSnapshots(admin, corp.id, lwIso))) {
            const lwOrders = await fetchOrders(token, guid, lwIso.replace(/-/g, ''));
            await backfillHourlyFromOrders(admin, corp.id, lwIso, lwOrders, tz);
            log.push(`${code} snapshot backfill ${lwIso}: done`);
          }
        } catch (e) { log.push(`${code} snapshot backfill: ${e.message}`); }
      }
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, log }) };
};
