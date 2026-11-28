-- Migration: room descriptions, task links, private workspaces and room approval
--
-- Covers the two follow-up rounds on the workspace feature:
--
--   Round 2  rooms.description, tasks.room_id
--   Round 3  workspaces.visibility, room_members approval columns
--
-- Run AFTER 014.
--
-- ── Why every column here needs this file ────────────────────────────────────
--
-- dbConnection calls sequelize.sync() with NO `alter`, so sync() creates
-- missing TABLES but never adds a column to a table that already exists. All
-- three tables from 014 already exist, so none of the columns below can appear
-- on their own — declaring them on the models is necessary but not sufficient.
--
-- Every statement is guarded, so the file is safe to re-run.

-- ── Round 2, part 1: rooms.description ───────────────────────────────────────
--
-- The one-line "what this room is for" under the room card's name.
ALTER TABLE tracker.rooms
  ADD COLUMN IF NOT EXISTS description VARCHAR(200);

-- ── Round 2, part 2: tasks.room_id ───────────────────────────────────────────
--
-- The real fix for the room task counts. Deriving a room's tasks from "tasks on
-- this project assigned to somebody in this room" double-counts anyone who sits
-- in two rooms on one project; an explicit link cannot.
--
-- Nullable, SET NULL: a task predates rooms and outlives one. Deleting a room
-- must not delete real work — same reasoning as tasks.group_id in 008.
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS room_id VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_room_id'
      AND conrelid = 'tracker.tasks'::regclass
  ) THEN
    ALTER TABLE tracker.tasks
      ADD CONSTRAINT fk_tasks_room_id
      FOREIGN KEY (room_id) REFERENCES tracker.rooms(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The room page asks for its own tasks; partial because most tasks have no room.
CREATE INDEX IF NOT EXISTS tasks_room_id
  ON tracker.tasks(room_id) WHERE room_id IS NOT NULL;

-- ── Round 3, part 1: workspaces.visibility ───────────────────────────────────
--
-- VARCHAR + CHECK, matching how status is stored in 014 rather than a PG enum.
--
-- Default 'private' on purpose, and the backfill below is deliberate too: every
-- workspace that existed before this migration becomes private. Defaulting the
-- other way would silently publish workspaces whose creators never chose to.
ALTER TABLE tracker.workspaces
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'private';

UPDATE tracker.workspaces SET visibility = 'private' WHERE visibility IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_workspaces_visibility'
      AND conrelid = 'tracker.workspaces'::regclass
  ) THEN
    ALTER TABLE tracker.workspaces
      ADD CONSTRAINT chk_workspaces_visibility
      CHECK (visibility IN ('private', 'public'));
  END IF;
END $$;

-- ── Round 3, part 2: room_members approval ───────────────────────────────────
--
-- status defaults to 'active' because a manager putting someone in a room IS
-- the approval. That keeps the wizard and the board writing exactly as they did
-- before this migration, and it backfills every existing row correctly: they
-- were all created by a manager, so they are all active.
ALTER TABLE tracker.room_members
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active';

ALTER TABLE tracker.room_members
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE tracker.room_members
  ADD COLUMN IF NOT EXISTS decided_by VARCHAR(20);

ALTER TABLE tracker.room_members
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_room_members_status'
      AND conrelid = 'tracker.room_members'::regclass
  ) THEN
    ALTER TABLE tracker.room_members
      ADD CONSTRAINT chk_room_members_status
      CHECK (status IN ('pending', 'active', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_room_members_decided_by'
      AND conrelid = 'tracker.room_members'::regclass
  ) THEN
    ALTER TABLE tracker.room_members
      ADD CONSTRAINT fk_room_members_decided_by
      FOREIGN KEY (decided_by) REFERENCES tracker.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Round 3, part 3: the unique constraint has to become partial ─────────────
--
-- 014 enforced "one room per workspace per user" with a plain
-- UNIQUE (workspace_id, user_id). With approval that rule is now too strong: an
-- active member of Frontend must still be able to REQUEST Backend, which needs
-- a second row for the same (workspace, user) pair.
--
-- The rule that actually matters is "one ACTIVE room per workspace per user",
-- so the index becomes partial on status = 'active'. Approving a pending
-- request re-checks it in code as well — the user may have gained a room
-- between asking and being approved — but this index is the backstop that makes
-- a race impossible rather than unlikely.
--
-- UNIQUE (room_id, user_id) from 014 is left exactly as it was: one row per
-- person per room whatever its status. A user re-asking for a room they were
-- rejected from flips that row back to 'pending' instead of inserting a second.
DROP INDEX IF EXISTS tracker.room_members_workspace_id_user_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_room_members_active_workspace_user
  ON tracker.room_members(workspace_id, user_id)
  WHERE status = 'active';

-- Non-unique replacement for the lookups the dropped index was also serving:
-- "the workspaces this user is in" runs on every read for a non-SP caller.
CREATE INDEX IF NOT EXISTS room_members_workspace_id_user_id
  ON tracker.room_members(workspace_id, user_id);

-- The manager's approval queue: pending rows for one workspace.
CREATE INDEX IF NOT EXISTS room_members_workspace_id_status
  ON tracker.room_members(workspace_id, status);

-- ── Housekeeping: one duplicate unique index on room_members ─────────────────
--
-- This database ended up with TWO identical unique indexes on
-- (room_id, user_id): sync() created room_members_room_id_user_id_key from the
-- model's `indexes` block, and 014's CREATE UNIQUE INDEX IF NOT EXISTS did not
-- match that name, so it added a second under its own. Both are enforced on
-- every membership insert, for one rule.
--
-- The 014-named one is kept because the migration owns that name; the
-- sync()-generated duplicate is dropped only when the keeper is present, so
-- this can never leave the table with no constraint at all.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'tracker'
      AND tablename = 'room_members'
      AND indexname = 'room_members_room_id_user_id'
  ) THEN
    -- sync() created it as a CONSTRAINT, not a bare index, so DROP INDEX is
    -- refused ("constraint ... requires it") and it has to go through ALTER.
    ALTER TABLE tracker.room_members
      DROP CONSTRAINT IF EXISTS room_members_room_id_user_id_key;
  END IF;
END $$;
