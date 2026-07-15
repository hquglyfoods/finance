-- ============================================================================
-- FIX: on a day the cash was short, a note typed on the auto "Counted cash" row
--      reappears after you delete it.
--
-- That row is created and re-synced by a trigger from the Cash tab count. The
-- trigger owns the AMOUNT (so the ledger always matches the count), but it also
-- forced the memo to 'Counted cash (Cash tab)' on insert, and the app treated
-- the row as fully auto: not editable, not deletable. So any note you added or
-- cleared was overwritten the next time the count synced.
--
-- The fix keeps the amount automatic but hands the NOTE to you:
--   * inserts start with an empty memo (no forced text)
--   * re-syncs update ONLY the amount, never the memo, so your note survives
--     every recount
--   * the app (next deploy) lets you edit or clear the note on this row
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_cash_count_to_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  -- amount is trigger-owned; memo is user-owned and never touched on re-sync
  update public.cash_ledger
     set amount = rec.counted_amount
   where corporation_id = rec.corporation_id and date = rec.date and auto_source = 'cash_count';
  if not found then
    insert into public.cash_ledger (corporation_id, date, direction, kind, amount, memo, auto_source)
    values (rec.corporation_id, rec.date, 'in', 'counted_cash', rec.counted_amount, null, 'cash_count');
  end if;
  return rec;
end; $$;

-- One-time cleanup: blank the forced placeholder so old rows start empty. Any note
-- a user genuinely typed is different text and is left alone.
UPDATE public.cash_ledger
   SET memo = null
 WHERE auto_source = 'cash_count'
   AND memo = 'Counted cash (Cash tab)';

-- Verify: no auto rows should still carry the placeholder.
SELECT count(*) AS rows_still_with_placeholder
FROM public.cash_ledger
WHERE auto_source = 'cash_count' AND memo = 'Counted cash (Cash tab)';
