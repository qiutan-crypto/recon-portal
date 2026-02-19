-- Migration: Role-based authentication system
-- Run this in the Supabase SQL Editor

-- 1. Create user_profiles table for role management
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'administrator' CHECK (role IN ('superuser', 'administrator')),
  display_name text,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

-- 2. Add created_by column to customers table (tracks which admin created the customer)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'created_by') THEN 
        ALTER TABLE customers ADD COLUMN created_by uuid REFERENCES auth.users(id); 
    END IF; 
END $$;

-- 3. Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile, superusers to read all
DROP POLICY IF EXISTS "Users read own profile" ON user_profiles;
CREATE POLICY "Users read own profile" ON user_profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'superuser')
  );

-- Allow superusers to insert profiles
DROP POLICY IF EXISTS "Superuser inserts profiles" ON user_profiles;
CREATE POLICY "Superuser inserts profiles" ON user_profiles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'superuser')
  );

-- Allow superusers to update profiles
DROP POLICY IF EXISTS "Superuser updates profiles" ON user_profiles;
CREATE POLICY "Superuser updates profiles" ON user_profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'superuser')
  );

-- Allow superusers to delete profiles
DROP POLICY IF EXISTS "Superuser deletes profiles" ON user_profiles;
CREATE POLICY "Superuser deletes profiles" ON user_profiles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'superuser')
  );

-- 4. Update customers RLS policies
DROP POLICY IF EXISTS "Public items access" ON customers;
DROP POLICY IF EXISTS "Admin sees own customers" ON customers;
DROP POLICY IF EXISTS "Auth users see customers" ON customers;
DROP POLICY IF EXISTS "Auth users manage customers" ON customers;
DROP POLICY IF EXISTS "Auth users update customers" ON customers;
DROP POLICY IF EXISTS "Auth users delete customers" ON customers;
DROP POLICY IF EXISTS "Anon reads customers" ON customers;

-- Anon can read customers (for case number login lookup)
CREATE POLICY "Anon reads customers" ON customers
  FOR SELECT TO anon USING (true);

-- Authenticated: admin sees own customers, superuser sees all
CREATE POLICY "Auth users see customers" ON customers
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'superuser')
    OR created_by IS NULL
  );

-- Authenticated can insert customers
CREATE POLICY "Auth users manage customers" ON customers
  FOR INSERT TO authenticated WITH CHECK (true);

-- Authenticated can update own customers (or superuser all)
CREATE POLICY "Auth users update customers" ON customers
  FOR UPDATE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'superuser')
    OR created_by IS NULL
  );

-- Authenticated can delete own customers (or superuser all)
CREATE POLICY "Auth users delete customers" ON customers
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'superuser')
    OR created_by IS NULL
  );

-- =====================================================
-- AFTER SETUP: Create the superuser account
-- =====================================================
-- 1. Go to Supabase Dashboard > Authentication > Users > Add User
--    Email: li@fivestartaxhelp.com
--    Password: (your chosen password)
--    Auto Confirm: YES
--
-- 2. Copy the user UUID from the dashboard, then run:
--    INSERT INTO user_profiles (id, email, role, display_name)
--    VALUES ('<paste-uuid-here>', 'li@fivestartaxhelp.com', 'superuser', 'Super Admin');
