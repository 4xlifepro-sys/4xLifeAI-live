-- Migration: Clean up duplicate plans and ensure UNIQUE constraint
-- Run this in Supabase SQL Editor

-- Step 1: Check current state
SELECT id, name, price, created_at 
FROM plans 
ORDER BY name, created_at;

-- Step 2: Delete duplicate rows, keeping only the oldest one for each name
-- This keeps the row with the earliest created_at for each plan name
DELETE FROM plans
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) as rn
    FROM plans
  ) t WHERE rn = 1
);

-- Step 3: Verify only one of each remains
SELECT id, name, price, created_at 
FROM plans 
ORDER BY name, created_at;

-- Step 4: Add UNIQUE constraint if it doesn't exist
-- This will fail if duplicates still exist, so run steps 2-3 first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'plans' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name = 'plans_name_unique'
  ) THEN
    ALTER TABLE plans 
    ADD CONSTRAINT plans_name_unique UNIQUE (name);
    RAISE NOTICE 'UNIQUE constraint added successfully';
  ELSE
    RAISE NOTICE 'UNIQUE constraint already exists';
  END IF;
END $$;

-- Step 5: Final verification
SELECT id, name, price, features, created_at 
FROM plans 
ORDER BY name;

-- Step 6: Verify the constraint is working
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name = 'plans';
