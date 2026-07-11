-- WHY IS THE VIEWER SEEING EMPTY DATA?  Run these in the Supabase SQL editor and share the output.
-- Replace 'VIEWER_EMAIL_HERE' with the viewer account's email.

-- 1) Does the viewer profile exist and have role = 'viewer'?
SELECT id, email, full_name, role, active
FROM public.profiles
WHERE email = 'VIEWER_EMAIL_HERE';

-- 2) Does the viewer have View permissions on the corporations?  (can_view must be true)
--    If this returns nothing, the fix is simply: in the app's Accounts tab, check "View"
--    for the corps you want this viewer to see. No SQL needed in that case.
SELECT pm.corporation_id, c.code, c.name, pm.can_view, pm.can_edit
FROM public.permissions pm
JOIN public.corporations c ON c.id = pm.corporation_id
WHERE pm.profile_id = (SELECT id FROM public.profiles WHERE email = 'VIEWER_EMAIL_HERE');

-- 3) If step 2 shows can_view = true but data is still empty, it's RLS.
--    Dump the SELECT policies on the tables the Home/Insights screens read, so the read
--    condition (the "qual" column) can be seen and a viewer-inclusive policy written.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'corporations','permissions','profiles',
    'daily_revenue','expenses','revenue_channels',
    'monthly_close','monthly_inputs','rate_schedule',
    'expense_categories','auto_expense_rules'
  )
  AND cmd IN ('SELECT','ALL')
ORDER BY tablename, policyname;
