-- Add survey_type column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'surveys' AND column_name = 'survey_type') THEN 
        ALTER TABLE surveys ADD COLUMN survey_type text DEFAULT 'reconciliation'; 
    END IF; 
END $$;
