-- User-managed custom "Type" options for Cash Out entries (in addition to the built-in ones
-- like Cash expense, Bank deposit, Owner draw, etc.). Owner-only. The ledger stores the type
-- name directly, so removing a type here never breaks past entries.

create table if not exists public.cash_out_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  display_order int  not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.cash_out_types enable row level security;

drop policy if exists cash_out_types_owner on public.cash_out_types;
create policy cash_out_types_owner on public.cash_out_types
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
