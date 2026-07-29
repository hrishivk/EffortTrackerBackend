-- Migration: Add start_date, end_date, status, progress to projects table
-- Run this FIRST before other migrations

ALTER TABLE tracker.projects
  ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;

-- Create enum type for project status if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_projects_status') THEN
    CREATE TYPE tracker.enum_projects_status AS ENUM ('active', 'on_hold', 'paused', 'completed');
  END IF;
END$$;

ALTER TABLE tracker.projects
  ADD COLUMN IF NOT EXISTS status tracker.enum_projects_status DEFAULT 'active';

-- Add constraint for progress range
ALTER TABLE tracker.projects
  ADD CONSTRAINT chk_projects_progress CHECK (progress >= 0 AND progress <= 100);
