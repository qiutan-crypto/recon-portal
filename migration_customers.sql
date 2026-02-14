-- Create Customers table
CREATE TABLE IF NOT EXISTS customers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- We keep 'name' for backward compatibility or as a full name field
  name text, 
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- Add new columns if they don't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'case_number') THEN 
        ALTER TABLE customers ADD COLUMN case_number text; 
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'first_name') THEN 
        ALTER TABLE customers ADD COLUMN first_name text; 
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'last_name') THEN 
        ALTER TABLE customers ADD COLUMN last_name text; 
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'phone_number') THEN 
        ALTER TABLE customers ADD COLUMN phone_number text; 
    END IF;
END $$;

-- Enable RLS for Customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Allow public access for demo purposes (or restrict as needed)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'customers' 
        AND policyname = 'Public items access'
    ) THEN
        CREATE POLICY "Public items access" ON customers FOR ALL USING (true);
    END IF;
END $$;


-- Add customer_id to Surveys
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'surveys' AND column_name = 'customer_id') THEN 
        ALTER TABLE surveys ADD COLUMN customer_id uuid REFERENCES customers(id); 
    END IF; 
END $$;
