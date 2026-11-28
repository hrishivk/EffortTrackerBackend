-- Migration: session-scoped workspace unlocks
--
-- Run AFTER 016.
--
-- ── Why this is not a room_members row ───────────────────────────────────────
--
-- "Unlocked with the key" and "is a member of a room" are deliberately separate
-- facts, and they have different lifetimes:
--
--   room_members  a manager's decision. Survives logout. Grants ROOMS.
--   this table    the caller typed the key. Dies with the login session.
--                 Grants sight of the workspace shell and nothing else.
--
-- Recording an unlock as a room_members row would make it permanent, so the key
-- would never be asked again after the first time — the opposite of the
-- requirement — and it would also silently add the person to a room's member
-- list, which a typed key must not do.
--
-- ── What "session" means here ────────────────────────────────────────────────
--
-- Auth is stateless JWT; there was no session record to hang this on. So login
-- now mints a `sid` claim into both the access and refresh tokens, and the
-- refresh path in verifyRole carries the SAME sid into the tokens it re-issues.
-- That last part matters: the access token lives 15 minutes, so without it a
-- user would be re-prompted for the key every quarter of an hour mid-session.
--
-- session_id is therefore that sid. It is not a FK — there is no sessions
-- table — so rows are cleared three ways: on logout by sid, by the ON DELETE
-- CASCADEs below, and by the sweep at the bottom for sessions that simply
-- expired without anyone logging out.
CREATE TABLE IF NOT EXISTS tracker.workspace_unlocks (
  id VARCHAR(20) PRIMARY KEY,
  -- The `sid` claim from the caller's JWT. Opaque here on purpose.
  session_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(20) NOT NULL
    REFERENCES tracker.users(id) ON DELETE CASCADE,
  workspace_id VARCHAR(20) NOT NULL
    REFERENCES tracker.workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One unlock per session per workspace: re-entering the key is a no-op, not a
-- second row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_unlocks_session_workspace
  ON tracker.workspace_unlocks(session_id, workspace_id);

-- The read path: "which workspaces has THIS session unlocked". user_id is in
-- the index so the lookup cannot be satisfied by a sid alone — a stolen or
-- guessed sid still has to belong to the calling user.
CREATE INDEX IF NOT EXISTS workspace_unlocks_session_id_user_id
  ON tracker.workspace_unlocks(session_id, user_id);

-- Logout deletes by sid; this supports it, and the age sweep below.
CREATE INDEX IF NOT EXISTS workspace_unlocks_created_at
  ON tracker.workspace_unlocks(created_at);

-- ── Housekeeping ─────────────────────────────────────────────────────────────
--
-- A session that expires without an explicit logout leaves its rows behind, and
-- nothing would ever collect them: the sid is opaque, so there is no way to ask
-- whether it is still valid. The refresh token lives 16 hours, so anything
-- older than that belongs to a session that cannot exist any more.
--
-- Run here to clear anything already stale, and repeated cheaply by the service
-- on each unlock write. Deliberately not a trigger: this is a tidy-up, and a
-- surviving row is harmless anyway — the read also checks user_id, and the
-- workspace may well have been made public or the person made a member since.
DELETE FROM tracker.workspace_unlocks
  WHERE created_at < NOW() - INTERVAL '16 hours';
