-- Migration: task tags
--
-- Free-form labels stored on the task itself as a text array, matching the
-- "tags": [...] array the create payload already sends. No second table:
-- these are plain strings, so a tags table plus a join would add two writes
-- and a join to every read for nothing.
--
-- If tags later need colours, renaming, or a per-user list to pick from — the
-- way task_groups works — they outgrow this and want their own table. Nothing
-- here blocks that: the array can be migrated into rows.
--
-- Applies to subtasks too, since a subtask is a row in this same table.

ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- GIN so `WHERE tags @> ARRAY['urgent']` can use an index when filtering by tag.
CREATE INDEX IF NOT EXISTS idx_tasks_tags ON tracker.tasks USING GIN (tags);
