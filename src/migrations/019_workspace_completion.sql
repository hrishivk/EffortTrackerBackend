-- Migration: workspace completion
--
-- Backs the "mark this workspace completed and tell a manager" button that sits
-- next to the workspace status.
--
-- Run AFTER 014 (which created workspaces and its status CHECK) and 015 (which
-- added visibility). Every statement is guarded, so the file is safe to re-run.
--
-- Three changes:
--   1. `completed` becomes a legal workspace status
--   2. completed_at  - when it was marked completed
--   3. completed_by  - who marked it
--
-- The notification itself needs no schema: `notifications` already exists and
-- takes an arbitrary `type` string.

-- ── 1. Widen the status CHECK ────────────────────────────────────────────────
--
-- Until now the only legal statuses were planning | active | on_hold, so there
-- was no way to say a workspace was FINISHED - the button had nothing to write.
--
-- This is exactly the case 014 chose VARCHAR + CHECK for rather than a PG enum.
-- Its comment reads: "009 had to drop the task_status enum to widen it; a CHECK
-- constraint is one ALTER away instead." This is that one ALTER.
--
-- Dropped and re-added rather than altered in place, because a CHECK
-- constraint has no ALTER ... MODIFY form. The gap between the two statements
-- is inside this file's implicit transaction when run via psql -f with
-- ON_ERROR_STOP, so the table is never left unconstrained to a committed
-- reader.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_workspaces_status'
      AND conrelid = 'tracker.workspaces'::regclass
  ) THEN
    ALTER TABLE tracker.workspaces DROP CONSTRAINT chk_workspaces_status;
  END IF;

  ALTER TABLE tracker.workspaces
    ADD CONSTRAINT chk_workspaces_status
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed'));
END $$;

-- ── 2. completed_at ─────────────────────────────────────────────────────────
--
-- Nullable, and NULL is meaningful: it means "not completed". The badge next to
-- the status reads "Completed 11 Sep" off this, which is not derivable from
-- `status` alone - updated_at moves on every edit, so it cannot stand in.
--
-- Set and cleared by the service, in step with status: moving to `completed`
-- stamps it, moving away nulls it. So it can never claim a completion date for
-- a workspace that is back in progress.
ALTER TABLE tracker.workspaces
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- ── 3. completed_by ─────────────────────────────────────────────────────────
--
-- SET NULL, not CASCADE: a completion outlives the person who recorded it,
-- exactly as room_members.decided_by does for an approval. Deleting the manager
-- who closed a workspace must not delete the workspace.
ALTER TABLE tracker.workspaces
  ADD COLUMN IF NOT EXISTS completed_by VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_workspaces_completed_by'
      AND conrelid = 'tracker.workspaces'::regclass
  ) THEN
    ALTER TABLE tracker.workspaces
      ADD CONSTRAINT fk_workspaces_completed_by
      FOREIGN KEY (completed_by) REFERENCES tracker.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Deliberately none. No workspace can currently be `completed` - the status did
-- not exist until this file ran - so there is nothing to date, and inventing a
-- completed_at for a planning or active workspace would be a lie.

-- ── Index ───────────────────────────────────────────────────────────────────
--
-- "the completed workspaces" is a list filter the UI will want; partial because
-- most workspaces are not completed.
CREATE INDEX IF NOT EXISTS idx_workspaces_completed_at
  ON tracker.workspaces(completed_at) WHERE completed_at IS NOT NULL;
