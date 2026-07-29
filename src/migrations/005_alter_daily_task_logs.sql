-- Migration: Add project_id to daily_task_logs table

ALTER TABLE tracker.daily_task_logs
  ADD COLUMN IF NOT EXISTS project_id VARCHAR(20) REFERENCES tracker.projects(id) ON DELETE CASCADE;

-- Create index for project_id lookups
CREATE INDEX IF NOT EXISTS idx_daily_task_logs_project_id ON tracker.daily_task_logs(project_id);
