-- Migration: Fix duplicate plans and add UNIQUE constraint
-- Run this in Supabase SQL Editor

-- Step 1: Check current state (run this first to see what we have)
SELECT id, name, price, created_at 
FROM plans 
ORDER BY name, created_at;

-- Step 2: Delete duplicate "Pro" rows, keeping only the oldest one (id 2)
-- This deletes all "Pro" rows except the one with the earliest created_at
DELETE FROM plans
WHERE name = 'Pro'
AND id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at) as rn
    FROM plans
    WHERE name = 'Pro'
  ) t WHERE rn = 1
);

-- Step 3: Delete duplicate "Free" rows if any exist
DELETE FROM plans
WHERE name = 'Free'
AND id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at) as rn
    FROM plans
    WHERE name = 'Free'
  ) t WHERE rn = 1
);

-- Step 4: Verify only one of each remains
SELECT id, name, price, created_at 
FROM plans 
ORDER BY name, created_at;

-- Step 5: Add UNIQUE constraint to prevent future duplicates
-- Note: This will fail if duplicates still exist, so run steps 2-4 first
ALTER TABLE plans 
ADD CONSTRAINT plans_name_unique UNIQUE (name);

-- Step 6: Final verification
SELECT id, name, price, features, created_at 
FROM plans 
ORDER BY name;
