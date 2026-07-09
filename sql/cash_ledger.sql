-- Cash Ledger: physical cash on hand per corporation, separate from the P&L revenue ledger.
-- Cash IN  = counted cash / transfer_in / opening_balance / other
-- Cash OUT = bank_deposit / owner_draw / bonus / reimburse / transfer_out / other
-- An OUT entry may optionally also post a P&L expense (expense_id links it). Inter-corp
-- transfers create two paired rows (out from A, in to B) sharing a transfer_group.
-- Owner-only (read + write).

create table if not exists public.cash_ledger (
  id                   uuid primary key default gen_random_uuid(),
  corporation_id       uuid not null references public.corporations(id),
  date                 date not null,
  direction            text not null check (direction in ('in','out')),
  kind                 text not null,
  amount               numeric not null check (amount >= 0),
  counterparty_corp_id uuid references public.corporations(id),
  transfer_group       uuid,
  memo                 text,
  expense_id           uuid,
  created_by           uuid,
  created_at           timestamptz not null default now()
);

create index if not exists cash_ledger_corp_date on public.cash_ledger(corporation_id, date);
create index if not exists cash_ledger_transfer   on public.cash_ledger(transfer_group);

alter table public.cash_ledger enable row level security;

drop policy if exists cash_ledger_owner on public.cash_ledger;
create policy cash_ledger_owner on public.cash_ledger
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
