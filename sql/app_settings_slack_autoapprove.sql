-- app_settings: small key/value store for owner-controlled app settings.
-- First use: slack_autoapprove_mode, read by netlify/functions/slack-expense.js at
-- insert time to decide whether a Slack-captured expense is auto-confirmed or left
-- pending for manual approval.
--
-- Values for slack_autoapprove_mode:
--   'off'  -> never auto-confirm; every Slack expense lands as pending  (rollout default)
--   'semi' -> auto-confirm only when Claude is confident AND it matches a past approval
--   'full' -> auto-confirm whenever Claude is confident
--
-- The Netlify function reads this with the service key (RLS is bypassed there).
-- The app UI reads/writes it with the anon key under the RLS policies below.

create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Seed the rollout default. Does not overwrite an existing value on re-run.
insert into public.app_settings (key, value)
values ('slack_autoapprove_mode', 'off')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- Any signed-in user may READ settings (the UI shows the current mode to everyone,
-- but only the owner can change it below).
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated
  using (true);

-- Only the owner may INSERT/UPDATE/DELETE settings.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
