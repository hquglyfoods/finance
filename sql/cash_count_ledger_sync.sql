-- Auto-link the Cash tab's counted cash (daily_revenue.counted_amount on the cash channel)
-- into the Cash Ledger as a "counted_cash" IN entry. Entering, editing, or clearing the
-- count in the Cash tab is reflected in the ledger automatically (via trigger), so the two
-- never drift. Auto rows are tagged auto_source='cash_count' and are managed by the trigger,
-- not by hand.

-- 1) Tag column so auto rows can be found/updated idempotently.
alter table public.cash_ledger add column if not exists auto_source text;
create unique index if not exists cash_ledger_autocount_uniq
  on public.cash_ledger(corporation_id, date, auto_source)
  where auto_source is not null;

-- 2) Trigger function: keep one ledger row per (corp, date) mirroring the cash count.
create or replace function public.sync_cash_count_to_ledger() returns trigger
language plpgsql security definer as $$
declare
  is_cash boolean;
  rec record;
begin
  rec := case when tg_op = 'DELETE' then old else new end;

  select (rc.code = 'cash') into is_cash from public.revenue_channels rc where rc.id = rec.channel_id;
  if not coalesce(is_cash, false) then
    return rec;
  end if;

  if tg_op = 'DELETE' or rec.counted_amount is null or rec.counted_amount = 0 then
    delete from public.cash_ledger
     where corporation_id = rec.corporation_id and date = rec.date and auto_source = 'cash_count';
    return rec;
  end if;

  update public.cash_ledger
     set amount = rec.counted_amount
   where corporation_id = rec.corporation_id and date = rec.date and auto_source = 'cash_count';
  if not found then
    insert into public.cash_ledger (corporation_id, date, direction, kind, amount, memo, auto_source)
    values (rec.corporation_id, rec.date, 'in', 'counted_cash', rec.counted_amount, 'Counted cash (Cash tab)', 'cash_count');
  end if;
  return rec;
end; $$;

drop trigger if exists trg_sync_cash_count on public.daily_revenue;
create trigger trg_sync_cash_count
  after insert or update of counted_amount or delete on public.daily_revenue
  for each row execute function public.sync_cash_count_to_ledger();

-- 3) Backfill existing counted amounts so current counts show in the ledger immediately.
insert into public.cash_ledger (corporation_id, date, direction, kind, amount, memo, auto_source)
select dr.corporation_id, dr.date, 'in', 'counted_cash', dr.counted_amount, 'Counted cash (Cash tab)', 'cash_count'
  from public.daily_revenue dr
  join public.revenue_channels rc on rc.id = dr.channel_id
 where rc.code = 'cash' and dr.counted_amount is not null and dr.counted_amount <> 0
   and not exists (
     select 1 from public.cash_ledger cl
      where cl.corporation_id = dr.corporation_id and cl.date = dr.date and cl.auto_source = 'cash_count');

-- Verify:
--   select co.code, count(*) filter (where auto_source='cash_count') as auto_count_rows,
--          sum(case when direction='in' then amount else -amount end) as balance
--     from cash_ledger cl join corporations co on co.id=cl.corporation_id group by co.code;
