-- Migration: Workspaces, rooms and room members
--
-- Backs the four-step Create Workspace wizard (/:role/workspace-setup). The
-- wizard writes ONCE, at step 4, so POST /role-user/workspaces creates the
-- whole tree in one transaction — see workspace.repository.createTree.
--
-- Shape: a workspace covers ONE project and holds many rooms (teams); a room
-- holds many users. A user sits in at most ONE room per workspace.
--
-- Run AFTER 007 (this file uses timestamptz to match it).
--
-- ── Re-runnable, including AFTER sync() has been here ────────────────────────
--
-- Unlike 008, sync() gets MOST of this one right on its own: the three tables
-- are new, so it creates them, their FKs and the indexes declared on the
-- models. Two things it can never create, because Sequelize cannot express
-- them, are the whole reason this file still has to run:
--
--   * chk_workspaces_status   — the CHECK on the three status tokens
--   * uq_workspaces_code      — UNIQUE on UPPER(code) WHERE code IS NOT NULL
--
-- So every statement below is written to be a no-op when sync() got there
-- first: the plain indexes carry sync()'s OWN names (workspaces_created_by,
-- not idx_workspaces_created_by) so IF NOT EXISTS actually matches and we do
-- not end up with two identical indexes on one column, and the CHECK is added
-- by a guarded ALTER rather than inline, since CREATE TABLE IF NOT EXISTS on an
-- existing table skips the constraint along with everything else.

-- ── Step 1: workspaces ───────────────────────────────────────────────────────
--
-- status is VARCHAR + CHECK, deliberately NOT a PG enum. 009 had to drop the
-- task_status enum to widen it; a CHECK constraint is one ALTER away instead of
-- a type rewrite. The three tokens are stored verbatim — the UI renders its
-- labels ("On Hold") off this value.
--
-- project_id is nullable ON DELETE SET NULL so a workspace outlives a deleted
-- project. CASCADE here would delete the rooms and the assignments with it.
--
-- created_by mirrors projects.created_by: nullable, SET NULL. It is taken from
-- the session, never from the payload.
CREATE TABLE IF NOT EXISTS tracker.workspaces (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  code VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'planning',
  description TEXT,
  project_id VARCHAR(20) REFERENCES tracker.projects(id) ON DELETE SET NULL,
  created_by VARCHAR(20) REFERENCES tracker.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The status CHECK, added separately so it lands on a sync()-created table too.
-- Guarded rather than dropped-and-recreated: re-adding it would rewrite the
-- table under a lock for nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_workspaces_status'
      AND conrelid = 'tracker.workspaces'::regclass
  ) THEN
    ALTER TABLE tracker.workspaces
      ADD CONSTRAINT chk_workspaces_status
      CHECK (status IN ('planning', 'active', 'on_hold'));
  END IF;
END $$;

-- The Workspace Key is unique when present, case-insensitively: the UI
-- uppercases as you type, so "pd-2026" and "PD-2026" are the same key to a
-- human and must not become two rows. A partial index leaves the blank ones
-- alone — code is optional and many workspaces will have none.
--
-- This is the statement sync() cannot reproduce: an index on an EXPRESSION
-- with a WHERE clause is outside what Sequelize's index declarations can say.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_code
  ON tracker.workspaces (UPPER(code))
  WHERE code IS NOT NULL;

-- Names below match what sync() derives from the model's `indexes` block, so
-- these are no-ops on a database it has already touched.
CREATE INDEX IF NOT EXISTS workspaces_created_by ON tracker.workspaces(created_by);
CREATE INDEX IF NOT EXISTS workspaces_project_id ON tracker.workspaces(project_id);

-- ── Step 2: rooms ────────────────────────────────────────────────────────────
--
-- CASCADE on workspace_id — a room has no meaning without its workspace.
--
-- project_id is denormalised (derivable from the workspace today) and kept on
-- purpose: it is what lets one workspace span several projects later without a
-- migration. Nullable/SET NULL for the same reason as workspaces.project_id.
CREATE TABLE IF NOT EXISTS tracker.rooms (
  id VARCHAR(20) PRIMARY KEY,
  workspace_id VARCHAR(20) NOT NULL
    REFERENCES tracker.workspaces(id) ON DELETE CASCADE,
  project_id VARCHAR(20) REFERENCES tracker.projects(id) ON DELETE SET NULL,
  name VARCHAR(40) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rooms are always read workspace-at-a-time, ordered by position.
CREATE INDEX IF NOT EXISTS rooms_workspace_id_position
  ON tracker.rooms(workspace_id, "position");
CREATE INDEX IF NOT EXISTS rooms_project_id ON tracker.rooms(project_id);

-- ── Step 3: room_members ─────────────────────────────────────────────────────
--
-- workspace_id is denormalised here for one reason: the second unique
-- constraint. "A user is in at most one room per workspace" cannot be expressed
-- against room_id alone, and the UI's drag depends on it — dropping someone
-- into a room MOVES them out of their previous one. Enforced in the DB as well
-- as in code, so a retried request or a second browser tab cannot produce two
-- rows for one person and make the Review step's "which room?" lookup
-- arbitrary.
CREATE TABLE IF NOT EXISTS tracker.room_members (
  id VARCHAR(20) PRIMARY KEY,
  room_id VARCHAR(20) NOT NULL
    REFERENCES tracker.rooms(id) ON DELETE CASCADE,
  workspace_id VARCHAR(20) NOT NULL
    REFERENCES tracker.workspaces(id) ON DELETE CASCADE,
  user_id VARCHAR(20) NOT NULL
    REFERENCES tracker.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- The two rules the drag depends on. Unique INDEXes rather than named
-- CONSTRAINTs, matching what sync() creates from the model so IF NOT EXISTS
-- matches instead of adding a second copy.
CREATE UNIQUE INDEX IF NOT EXISTS room_members_room_id_user_id
  ON tracker.room_members(room_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS room_members_workspace_id_user_id
  ON tracker.room_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS room_members_user_id ON tracker.room_members(user_id);
