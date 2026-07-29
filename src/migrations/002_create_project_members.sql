-- Migration: Create project_members join table
-- Run this AFTER projects and users tables exist

CREATE TABLE IF NOT EXISTS tracker.project_members (
  id VARCHAR(20) PRIMARY KEY,
  project_id VARCHAR(20) NOT NULL REFERENCES tracker.projects(id) ON DELETE CASCADE,
  user_id VARCHAR(20) NOT NULL REFERENCES tracker.users(id) ON DELETE CASCADE,
  role VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_project_members_project_user UNIQUE (project_id, user_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON tracker.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON tracker.project_members(user_id);

-- Migrate existing user-project relationships to project_members
-- This copies data from users.project_id into the new join table
INSERT INTO tracker.project_members (id, project_id, user_id, role, created_at)
SELECT
  substr(md5(random()::text), 1, 15),
  project_id,
  id,
  role,
  NOW()
FROM tracker.users
WHERE project_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;
