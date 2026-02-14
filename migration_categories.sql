-- Add categories column to surveys table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'surveys' AND column_name = 'categories') THEN 
        ALTER TABLE surveys ADD COLUMN categories jsonb DEFAULT '["Personal Expense", "Loan", "Business Expense", "Account Transfer"]'::jsonb; 
    END IF; 
END $$;
