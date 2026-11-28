-- Migration: subtasks
--
-- A subtask is a task with a parent, not a separate kind of thing. Modelling it
-- as a child row in tasks means it gets status, priority, start_date/due_date,
-- the session timer and the group lanes for free, and every existing query keeps
-- working. A separate table would have to duplicate all of it.
--
-- ON DELETE CASCADE: deleting a task deletes its subtasks. A subtask cannot
-- outlive its parent — there would be nothing to nest it under.

ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS parent_id VARCHAR(20)
    REFERENCES tracker.tasks(id) ON DELETE CASCADE;

-- The board lists only parents and nests their children, so both halves of that
-- query filter on this column.
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tracker.tasks(parent_id);
