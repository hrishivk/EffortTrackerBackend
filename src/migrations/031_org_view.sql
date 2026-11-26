-- Migration: org view (departments as a tree, people by department)
--
-- Run AFTER 030, and BEFORE deploying the code that declares these columns on
-- the User and Domain models. Sequelize SELECTs every declared attribute, and
-- sync() does not add columns, so the code on a database without this
-- migration fails every read of users and domains.
--
-- Everything here is additive and nullable. The web portal and the current app
-- keep working untouched: they never read the new columns, and the
-- `department` string stays in place (the service keeps writing it).
--
-- Re-running is safe: IF NOT EXISTS throughout, the constraint adds are
-- guarded, and the backfill only fills rows that are still NULL.

BEGIN;

-- ── 1. New columns ──────────────────────────────────────────────────────────

-- A person's primary department, by id. The `department` string was the only
-- link before, so renaming a department silently orphaned its people. Shared
-- users (is_shared) keep their many-to-many link through domain_assignments
-- and may leave this NULL.
ALTER TABLE tracker.users
  ADD COLUMN IF NOT EXISTS domain_id VARCHAR(20);

-- The department card's head, and the department tree.
ALTER TABLE tracker.domains
  ADD COLUMN IF NOT EXISTS head_user_id VARCHAR(20),
  ADD COLUMN IF NOT EXISTS parent_id VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ── 2. Clean manager_id before it gets a foreign key ────────────────────────
--
-- manager_id has always been set (to whoever created the user) and leave
-- approval, AM team scoping and reports all route through it, so VALID values
-- are left exactly as they are. Only values a foreign key would reject are
-- cleared: blanks, ids of users that no longer exist, and self-references.
UPDATE tracker.users u
   SET manager_id = NULL
 WHERE u.manager_id IS NOT NULL
   AND (
         btrim(u.manager_id) = ''
      OR u.manager_id = u.id
      OR NOT EXISTS (SELECT 1 FROM tracker.users m WHERE m.id = u.manager_id)
   );

-- ── 3. Foreign keys ─────────────────────────────────────────────────────────
--
-- ON DELETE SET NULL on every one: DELETE /delete-user removes the row
-- outright, and a plain foreign key would make deleting a manager or a
-- department head fail for as long as anyone points at them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_domain_id_fkey') THEN
    ALTER TABLE tracker.users
      ADD CONSTRAINT users_domain_id_fkey
      FOREIGN KEY (domain_id) REFERENCES tracker.domains(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_manager_id_fkey') THEN
    ALTER TABLE tracker.users
      ADD CONSTRAINT users_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES tracker.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domains_head_user_id_fkey') THEN
    ALTER TABLE tracker.domains
      ADD CONSTRAINT domains_head_user_id_fkey
      FOREIGN KEY (head_user_id) REFERENCES tracker.users(id) ON DELETE SET NULL;
  END IF;

  -- Deleting a parent lifts its sub-departments to the top level rather than
  -- deleting them.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domains_parent_id_fkey') THEN
    ALTER TABLE tracker.domains
      ADD CONSTRAINT domains_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES tracker.domains(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domains_parent_not_self') THEN
    ALTER TABLE tracker.domains
      ADD CONSTRAINT domains_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

-- ── 4. Backfill users.domain_id ─────────────────────────────────────────────

-- 4a. By name, ignoring case and surrounding spaces.
UPDATE tracker.users u
   SET domain_id = d.id
  FROM tracker.domains d
 WHERE u.domain_id IS NULL
   AND u.department IS NOT NULL
   AND lower(btrim(u.department)) = lower(btrim(d.name));

-- 4b. Fallback for a non-shared user whose department string matched nothing
-- but who is linked to exactly ONE domain through domain_assignments. One link
-- is unambiguous; two or more is left for an admin to decide.
UPDATE tracker.users u
   SET domain_id = only_link.domain_id
  FROM (
    SELECT user_id, MIN(domain_id) AS domain_id
      FROM tracker.domain_assignments
     GROUP BY user_id
    HAVING COUNT(DISTINCT domain_id) = 1
  ) only_link
 WHERE u.domain_id IS NULL
   AND u.is_shared = false
   AND only_link.user_id = u.id;

-- ── 5. The unmatched-users report ───────────────────────────────────────────
--
-- A view rather than a one-off table, so it stays current: a user drops off it
-- the moment an admin sets their department in the app.
--
--   SELECT * FROM tracker.users_without_department;
CREATE OR REPLACE VIEW tracker.users_without_department AS
SELECT u.id,
       u.full_name,
       u.email,
       u.role,
       u.department AS department_text,
       u.is_blocked
  FROM tracker.users u
 WHERE u.domain_id IS NULL
   AND u.is_shared = false
   AND u.role <> 'SP';

-- ── 6. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_domain_id ON tracker.users(domain_id);
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON tracker.users(manager_id);
CREATE INDEX IF NOT EXISTS idx_domains_parent_id ON tracker.domains(parent_id);
-- The doc asks for tasks(assigned_to, status) and daily_task_logs(user_id,
-- date). Neither column exists under that name: a task's assignee lives on its
-- daily log (assigned_to), and 021 already indexes daily_task_logs
-- (assigned_to, date) and tasks(daily_log_id). The status split is grouped
-- after that join, so the task-side index that serves it is this one:
CREATE INDEX IF NOT EXISTS idx_tasks_daily_log_status ON tracker.tasks(daily_log_id, status);
-- Overdue counts and upcoming deadlines.
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tracker.tasks(due_date);

COMMIT;
