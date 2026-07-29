-- Migration: Replace tasks.project (string) with tasks.project_id (FK)
-- Also update status enum values

-- Step 1: Add project_id column
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS project_id VARCHAR(20) REFERENCES tracker.projects(id) ON DELETE CASCADE;

-- Step 2: Drop old project string column
ALTER TABLE tracker.tasks
  DROP COLUMN IF EXISTS project;

-- Step 3: Update status enum
-- Drop old enum and create new one
DO $$
BEGIN
  -- Rename old enum
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_tasks_status') THEN
    ALTER TYPE tracker.enum_tasks_status RENAME TO enum_tasks_status_old;
  END IF;

  -- Create new enum
  CREATE TYPE tracker.enum_tasks_status AS ENUM ('yet_to_start', 'in_progress', 'completed', 'blocked');

  -- Alter column to use new enum with value mapping
  ALTER TABLE tracker.tasks
    ALTER COLUMN status TYPE tracker.enum_tasks_status
    USING CASE status::text
      WHEN 'yet to start' THEN 'yet_to_start'::tracker.enum_tasks_status
      WHEN 'In Progress' THEN 'in_progress'::tracker.enum_tasks_status
      WHEN 'Completed' THEN 'completed'::tracker.enum_tasks_status
      ELSE 'yet_to_start'::tracker.enum_tasks_status
    END;

  -- Set new default
  ALTER TABLE tracker.tasks
    ALTER COLUMN status SET DEFAULT 'yet_to_start'::tracker.enum_tasks_status;

  -- Drop old enum
  DROP TYPE IF EXISTS tracker.enum_tasks_status_old;
END$$;

-- Create index for project_id lookups
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tracker.tasks(project_id);
