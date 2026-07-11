-- Allow the new read-only 'viewer' role on the profiles table.
-- The insert failed because profiles.role has a CHECK constraint (profiles_role_check)
-- whose allowed set did not include 'viewer'.
--
-- STEP 1 (optional but recommended): see which role values are currently in use,
-- so you can make sure none are accidentally dropped from the new constraint.
--   SELECT DISTINCT role FROM public.profiles;
--
-- STEP 2: replace the constraint to include 'viewer'.
-- If your table also uses other roles (e.g. 'franchisee'), add them to the IN (...) list below.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'assistant', 'investor', 'viewer'));
