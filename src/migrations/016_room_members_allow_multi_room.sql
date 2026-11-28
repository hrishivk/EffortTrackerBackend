-- Migration: a user may be in SEVERAL rooms of one workspace
--
-- Run AFTER 015.
--
-- ── What this reverses, and why ──────────────────────────────────────────────
--
-- 014 and 015 enforced "a user is in at most one room per workspace", because
-- that was the rule the wizard's drag implemented: dropping someone into a room
-- REMOVED them from whichever room they were in.
--
-- The frontend has since changed that deliberately. A drag now ADDS, leaving
-- other memberships alone, so one person can sit in Frontend and Testing at
-- once. The old constraint does not merely become unnecessary — it actively
-- blocks the new behaviour with a unique violation on the second room.
--
-- So the constraint goes. Note what does NOT go:
--
--   * UNIQUE (room_id, user_id) stays. Nobody twice in the SAME room, which is
--     what makes a repeated add a no-op instead of an inflated member count.
--
--   * room_members.workspace_id stays. Its original justification was this
--     constraint, but it earns its place twice over now: the approval queue
--     reads pending rows by workspace, and every non-SP read resolves
--     visibility through (workspace_id, user_id, status). Deriving those
--     through a join to rooms on every request would cost more than the column.
--
-- ── Consequence to expect, not to fix ───────────────────────────────────────
--
-- Per-room member counts now sum to MORE than the workspace's user count: three
-- people spread as 2 + 1 + 2 is five membership rows. That is correct. The hero
-- stat is COUNT(DISTINCT user_id), so it reports three, and the two numbers are
-- answering different questions.
DROP INDEX IF EXISTS tracker.uq_room_members_active_workspace_user;

-- Belt and braces: if this ever runs on a database where 014's strict version
-- survived under its own name (a fresh install that skipped 015, say), that one
-- has to go too, or the second room still fails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'tracker'
      AND tablename = 'room_members'
      AND indexname = 'room_members_workspace_id_user_id'
      AND indexdef LIKE '%UNIQUE%'
  ) THEN
    DROP INDEX tracker.room_members_workspace_id_user_id;
  END IF;

  -- Same index as a CONSTRAINT, which is how sync() would have made it.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_members_workspace_id_user_id_key'
      AND conrelid = 'tracker.room_members'::regclass
  ) THEN
    ALTER TABLE tracker.room_members
      DROP CONSTRAINT room_members_workspace_id_user_id_key;
  END IF;
END $$;

-- The non-unique lookup index the visibility checks need. Recreated here in
-- case the guard above dropped a unique index of the same name.
CREATE INDEX IF NOT EXISTS room_members_workspace_id_user_id
  ON tracker.room_members(workspace_id, user_id);
