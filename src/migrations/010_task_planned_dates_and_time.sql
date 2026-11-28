-- Migration: separate the manager's PLAN from the developer's ACTUAL work,
-- and make total_time real.
--
-- Before this, the Create Task form's "Due Date" was written into end_time --
-- the same column that updateTaskLane overwrites with NOW() when a task is
-- completed. So finishing a task destroyed its deadline, and "Start Date" was
-- dropped on the floor entirely. total_time has existed as varchar(50) since
-- the table was created but was never declared on the Sequelize model, so all
-- 656 rows hold NULL.
--
-- After this:
--   start_date / due_date  = the plan, set by whoever creates the task
--   start_time / end_time  = the actual work, stamped on status transitions
--   total_seconds          = accumulated working time across every session
--   total_time             = the same value formatted for display ("3h 30m")

ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS due_date   DATE,
  ADD COLUMN IF NOT EXISTS total_seconds INTEGER NOT NULL DEFAULT 0;

-- Rescue the deadlines that are currently sitting in end_time.
-- Only for tasks that are NOT finished: for those, end_time is still the due
-- date the manager typed, because nothing has overwritten it yet. A completed
-- task's end_time is a genuine finish stamp and is left alone.
-- This COPIES rather than moves, so nothing is lost if the guess is wrong.
UPDATE tracker.tasks
   SET due_date = end_time::date
 WHERE end_time IS NOT NULL
   AND due_date IS NULL
   AND status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tracker.tasks(due_date);
