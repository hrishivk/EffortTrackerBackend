-- Migration: tasks.status becomes free text and carries the lane name
--
-- Requested change: when a task is parked in a group, status should read that
-- group's name ("production") rather than staying on its old status value.
-- The enum cannot hold arbitrary names, so status becomes VARCHAR(100) —
-- matching task_groups.name so any group name fits.
--
-- CONSEQUENCES, deliberately accepted:
--   * The old status of a grouped task is OVERWRITTEN and unrecoverable. The
--     3 tasks currently sitting in "production" with status 'completed' stop
--     counting as completed.
--   * super_admin completion metrics (CASE WHEN status = 'completed') undercount
--     from here on for any task parked in a non-status group.
--   * The status query filter on /task-list still only matches the four real
--     values; group-named statuses are not filterable.
--
-- Groups whose NAME spells a status still normalise to the canonical value
-- ('Completed' -> 'completed'), so the four real states keep one spelling.

-- Step 1: drop the enum default before retyping the column
ALTER TABLE tracker.tasks ALTER COLUMN status DROP DEFAULT;

-- Step 2: enum -> text. Existing 655 values carry over unchanged.
ALTER TABLE tracker.tasks
  ALTER COLUMN status TYPE VARCHAR(100) USING status::text;

ALTER TABLE tracker.tasks ALTER COLUMN status SET DEFAULT 'yet_to_start';

-- Step 3: the enum type is now unreferenced
DROP TYPE IF EXISTS tracker.task_status;
DROP TYPE IF EXISTS tracker.enum_tasks_status;

-- Step 4: backfill already-grouped tasks to match the new rule.
-- Non-status group -> its name verbatim.
UPDATE tracker.tasks t
   SET status = g.name,
       updated_at = NOW()
  FROM tracker.task_groups g
 WHERE g.id = t.group_id
   AND lower(replace(replace(g.name, ' ', '_'), '-', '_'))
       NOT IN ('yet_to_start', 'in_progress', 'completed', 'blocked');

-- Status-named group -> the canonical status value.
UPDATE tracker.tasks t
   SET status = lower(replace(replace(g.name, ' ', '_'), '-', '_')),
       updated_at = NOW()
  FROM tracker.task_groups g
 WHERE g.id = t.group_id
   AND lower(replace(replace(g.name, ' ', '_'), '-', '_'))
       IN ('yet_to_start', 'in_progress', 'completed', 'blocked');
