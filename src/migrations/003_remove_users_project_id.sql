-- Migration: Remove project_id from users table
-- Run this AFTER project_members data has been migrated (002)

-- Drop the foreign key constraint first (if it exists)
ALTER TABLE tracker.users
  DROP CONSTRAINT IF EXISTS users_project_id_fkey;

-- Drop the column
ALTER TABLE tracker.users
  DROP COLUMN IF EXISTS project_id;
