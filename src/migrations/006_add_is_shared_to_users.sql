-- Migration: Add is_shared to users
-- A "shared" user (e.g. a tester / QA working across every project) is visible
-- to ALL managers (AM), not only to the manager who created them.
--
-- manager_id is deliberately left alone: it stays the user's primary/approving
-- manager, which leave approval routing depends on (see leave.repository.ts).

ALTER TABLE tracker.users
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- Speeds up the "manager_id = me OR is_shared = true" user-list filter
CREATE INDEX IF NOT EXISTS users_is_shared_idx
  ON tracker.users (is_shared)
  WHERE is_shared = true;
