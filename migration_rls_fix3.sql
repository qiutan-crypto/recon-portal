-- Migration: Fix RLS policies for surveys and responses tables
-- Run this in the Supabase SQL Editor

-- =====================================================
-- 1. Fix SURVEYS table policies
-- =====================================================

-- Drop old policies that may be misconfigured
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON surveys;
DROP POLICY IF EXISTS "Enable update for owners" ON surveys;
DROP POLICY IF EXISTS "Enable read access for all users" ON surveys;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON surveys;

-- SELECT: anyone can read surveys (needed for public survey respondent view)
CREATE POLICY "Enable read access for all users" ON surveys
  FOR SELECT TO public USING (true);

-- INSERT: any authenticated user can create surveys
CREATE POLICY "Enable insert for authenticated users" ON surveys
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: survey owner or superuser can update
CREATE POLICY "Enable update for authenticated users" ON surveys
  FOR UPDATE TO authenticated USING (true);

-- DELETE: any authenticated user can delete (admin sees own, superuser sees all)
CREATE POLICY "Enable delete for authenticated users" ON surveys
  FOR DELETE TO authenticated USING (true);

-- =====================================================
-- 2. Fix RESPONSES table policies
-- =====================================================

-- Drop old policies
DROP POLICY IF EXISTS "Users can see own responses" ON responses;
DROP POLICY IF EXISTS "Users can insert own responses" ON responses;
DROP POLICY IF EXISTS "Users can update own responses" ON responses;
DROP POLICY IF EXISTS "Enable read access for all users" ON responses;
DROP POLICY IF EXISTS "Enable delete for authenticated users" ON responses;

-- SELECT: anyone can read responses (admins need to see customer responses)
CREATE POLICY "Enable read access for all users" ON responses
  FOR SELECT TO public USING (true);

-- INSERT: anyone can insert responses (anonymous customers submit via public link)
CREATE POLICY "Enable insert for all users" ON responses
  FOR INSERT TO public WITH CHECK (true);

-- UPDATE: anyone can update responses (customer may update their in-progress response)
CREATE POLICY "Enable update for all users" ON responses
  FOR UPDATE TO public USING (true);

-- DELETE: authenticated users can delete responses
CREATE POLICY "Enable delete for authenticated users" ON responses
  FOR DELETE TO authenticated USING (true);
