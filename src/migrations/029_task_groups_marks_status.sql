-- Migration: a lane that sets a status
--
-- Run AFTER 028.
--
-- A custom lane ("Production", "Done", ...) is a place, not a state: a card
-- dropped there keeps its status. marks_status lets the lane's owner choose
-- otherwise — a card moved into a lane with marks_status = 'completed' is
-- completed (and so is no longer carried over to the next day).
--
-- NULL (every existing lane) keeps today's behaviour. Only forward states are
-- allowed: the usual transition rules still apply, so a task that was never
-- started cannot be completed by a drop.
ALTER TABLE tracker.task_groups
  ADD COLUMN IF NOT EXISTS marks_status VARCHAR(20)
    CHECK (marks_status IS NULL OR marks_status IN ('in_progress', 'completed'));
