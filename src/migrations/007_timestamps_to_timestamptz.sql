-- Migration: convert naive `timestamp` columns to `timestamptz`
--
-- WHY: node-postgres parses `timestamp without time zone` into a JS Date using
-- the Node process's local timezone. On an IST box a stored UTC value of
-- 09:10 was being read back as 09:10 IST = 03:40Z — a -330 minute drift — so
-- API responses and elapsed-time timers were wrong by 5h30m.
--
-- The `AT TIME ZONE 'UTC'` clause is load-bearing: it declares that the
-- existing naive values ARE already UTC (verified — stored values match now()),
-- so no stored data moves. WITHOUT it Postgres assumes the session TimeZone
-- and silently shifts every historical row.
--
-- Tables created by sequelize.sync() (attendance, leaves, notifications,
-- project_members, domain_assignments) are already timestamptz and are skipped.
--
-- NOTE: changing a column type rewrites the table under an ACCESS EXCLUSIVE
-- lock. These tables are small (users=13 rows) so it is effectively instant,
-- but it is not a metadata-only change like migration 006 was.

BEGIN;

ALTER TABLE tracker.tasks
  ALTER COLUMN start_time TYPE timestamptz USING start_time AT TIME ZONE 'UTC',
  ALTER COLUMN end_time   TYPE timestamptz USING end_time   AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE tracker.daily_task_logs
  ALTER COLUMN locked_at  TYPE timestamptz USING locked_at  AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE tracker.users
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE tracker.domains
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- projects.start_date / end_date are declared DataTypes.DATE in the model, so
-- they are converted for consistency. See the caveat in the handover notes:
-- if these are meant to be pure calendar dates they should become `date`
-- instead (as tracker.leaves.start_date already is), not timestamptz.
ALTER TABLE tracker.projects
  ALTER COLUMN start_date TYPE timestamptz USING start_date AT TIME ZONE 'UTC',
  ALTER COLUMN end_date   TYPE timestamptz USING end_date   AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

COMMIT;
