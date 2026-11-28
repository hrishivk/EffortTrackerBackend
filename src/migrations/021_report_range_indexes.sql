-- Migration: indexes for date-ranged reads
--
-- §0 gave GET /task-list a from/to window and added the two report routes, and
-- both ask the same question: "the tasks that sit in these people's daily logs
-- between these two dates". That question had no index behind it at all.
--
-- What is actually on these tables today:
--
--   daily_task_logs   the primary key, and nothing else. Not date, not
--                     assigned_to. Every /task-list read and every report
--                     window is a sequential scan of the whole table.
--   tasks             daily_log_id appears only inside idx_tasks_child_daily_log,
--                     which is PARTIAL (WHERE parent_id IS NOT NULL), so it
--                     cannot serve a join that has to reach parents as well.
--
-- (005's idx_daily_task_logs_project_id and 004's idx_tasks_project_id are
-- absent from the live database too — worth a look, but not this migration's
-- business.)
--
-- These are pure read-path indexes: no column changes, no data rewritten, and
-- IF NOT EXISTS throughout, so re-running is a no-op.

-- The report's WHERE clause, in its own column order: pin assigned_to, then
-- range-scan date. Also serves findDailyLogs for every role, which selects on
-- assigned_to (or created_by) AND date.
CREATE INDEX IF NOT EXISTS idx_daily_task_logs_assigned_to_date
  ON tracker.daily_task_logs(assigned_to, date);

-- The other half of findDailyLogs. created_by matters because a manager who
-- creates a task for someone else still sees it on their own board (rule 3 of
-- §3), which is an OR branch Postgres plans separately.
CREATE INDEX IF NOT EXISTS idx_daily_task_logs_created_by_date
  ON tracker.daily_task_logs(created_by, date);

-- logIdsForWindow filters on date ALONE — it is the room-wide read rule, which
-- is bounded by the window rather than by who is asking. Without this that
-- lookup scans the table on every board load for anyone in a room.
CREATE INDEX IF NOT EXISTS idx_daily_task_logs_date
  ON tracker.daily_task_logs(date);

-- The join both report queries drive: tasks -> daily_task_logs. Unpartitioned,
-- unlike idx_tasks_child_daily_log, because a report counts parents and
-- subtasks alike.
CREATE INDEX IF NOT EXISTS idx_tasks_daily_log_id
  ON tracker.tasks(daily_log_id);

-- ?project_id= on both report routes filters tasks by project inside the
-- window. 004 declared this index but it is not on the live database; the
-- IF NOT EXISTS makes re-declaring it free either way.
CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON tracker.tasks(project_id);
