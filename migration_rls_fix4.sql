-- DIAGNOSTIC + FIX: Surveys table RLS
-- Run this in the Supabase SQL Editor

-- Step 1: List ALL existing policies on surveys table (for diagnosis)
-- Check the output of this query first:
SELECT policyname, cmd, permissive, roles, qual, with_check 
FROM pg_policies 
WHERE tablename = 'surveys';

-- Step 2: NUCLEAR OPTION - Drop ALL policies on surveys, then recreate clean ones
-- Drop every possible policy name we've ever created
DROP POLICY IF EXISTS "Enable read access for all users" ON surveys;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON surveys;
DROP POLICY IF EXISTS "Enable update for owners" ON surveys;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON surveys;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON surveys;
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON surveys;
DROP POLICY IF EXISTS "Public items access" ON surveys;
DROP POLICY IF EXISTS "surveys_select_policy" ON surveys;
DROP POLICY IF EXISTS "surveys_insert_policy" ON surveys;
DROP POLICY IF EXISTS "surveys_update_policy" ON surveys;
DROP POLICY IF EXISTS "surveys_delete_policy" ON surveys;

-- Step 3: Temporarily DISABLE RLS to unblock everything
ALTER TABLE surveys DISABLE ROW LEVEL SECURITY;

-- Step 4: Re-enable RLS with clean, simple policies
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

-- Allow EVERYONE to read surveys (needed for public survey links)
CREATE POLICY "surveys_select" ON surveys FOR SELECT USING (true);
-- Allow authenticated users to insert
CREATE POLICY "surveys_insert" ON surveys FOR INSERT TO authenticated WITH CHECK (true);
-- Allow authenticated users to update
CREATE POLICY "surveys_update" ON surveys FOR UPDATE TO authenticated USING (true);
-- Allow authenticated users to delete
CREATE POLICY "surveys_delete" ON surveys FOR DELETE TO authenticated USING (true);

-- Step 5: Verify the new policies
SELECT policyname, cmd, permissive, roles, qual, with_check 
FROM pg_policies 
WHERE tablename = 'surveys';
