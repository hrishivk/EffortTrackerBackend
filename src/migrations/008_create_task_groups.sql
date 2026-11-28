-- Migration: Board groups — a user-created lane on the task board
--
-- A task belongs to exactly one lane: if group_id is set the card sits in that
-- group's lane, otherwise it sits in its status lane. That keeps tasks.status
-- restricted to the four enum values instead of having group slugs smuggled
-- into it.
--
-- Run AFTER 007 (this file uses timestamptz to match it).

-- Step 1: The groups themselves.
-- Scoped per user: a group belongs to the person whose board it is drawn on.
-- ON DELETE CASCADE on user_id — a deleted user's lanes go with them.
CREATE TABLE IF NOT EXISTS tracker.task_groups (
  id VARCHAR(20) PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL REFERENCES tracker.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_task_groups_user_name UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_groups_user_id ON tracker.task_groups(user_id);

-- Step 2: The link from a task to its group.
--
-- NULLABLE because most tasks live in a status lane and belong to no group.
--
-- ON DELETE SET NULL is load-bearing: deleting a group must return its tasks to
-- their status lane. CASCADE here would delete real work, and NO ACTION would
-- make a group with tasks in it undeletable.
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS group_id VARCHAR(20)
    REFERENCES tracker.task_groups(id) ON DELETE SET NULL;

-- The board buckets on group_id, so this index carries the lane lookup.
CREATE INDEX IF NOT EXISTS idx_tasks_group_id ON tracker.tasks(group_id);
