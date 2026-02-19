-- Migration: Fix RLS circular reference on user_profiles
-- Run this in the Supabase SQL Editor

-- 1. Create a SECURITY DEFINER function to check user role
--    This bypasses RLS to avoid infinite recursion
CREATE OR REPLACE FUNCTION public.get_user_role(check_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = check_user_id;
$$;

-- 2. Fix user_profiles SELECT policy - simplify to allow all authenticated users to read
--    (role info is not sensitive, and this avoids the circular reference)
DROP POLICY IF EXISTS "Users read own profile" ON user_profiles;
CREATE POLICY "Users read own profile" ON user_profiles
  FOR SELECT TO authenticated USING (true);

-- 3. Fix INSERT policy to use the helper function
DROP POLICY IF EXISTS "Superuser inserts profiles" ON user_profiles;
CREATE POLICY "Superuser inserts profiles" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (
    public.get_user_role(auth.uid()) = 'superuser'
  );

-- 4. Fix UPDATE policy
DROP POLICY IF EXISTS "Superuser updates profiles" ON user_profiles;
CREATE POLICY "Superuser updates profiles" ON user_profiles
  FOR UPDATE TO authenticated USING (
    public.get_user_role(auth.uid()) = 'superuser'
  );

-- 5. Fix DELETE policy
DROP POLICY IF EXISTS "Superuser deletes profiles" ON user_profiles;
CREATE POLICY "Superuser deletes profiles" ON user_profiles
  FOR DELETE TO authenticated USING (
    public.get_user_role(auth.uid()) = 'superuser'
  );

-- 6. Also update customers policies to use the helper function
DROP POLICY IF EXISTS "Auth users see customers" ON customers;
CREATE POLICY "Auth users see customers" ON customers
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR public.get_user_role(auth.uid()) = 'superuser'
    OR created_by IS NULL
  );

DROP POLICY IF EXISTS "Auth users update customers" ON customers;
CREATE POLICY "Auth users update customers" ON customers
  FOR UPDATE TO authenticated USING (
    created_by = auth.uid()
    OR public.get_user_role(auth.uid()) = 'superuser'
    OR created_by IS NULL
  );

DROP POLICY IF EXISTS "Auth users delete customers" ON customers;
CREATE POLICY "Auth users delete customers" ON customers
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR public.get_user_role(auth.uid()) = 'superuser'
    OR created_by IS NULL
  );
