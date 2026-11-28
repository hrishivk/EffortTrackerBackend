-- Migration: shared board lanes
--
-- The four lanes everyone needs — Yet to Start, In Progress, Completed and
-- Production — become visible to every user, while any group a user creates
-- afterwards stays private to them. Mirrors the users.is_shared convention from
-- migration 006.
--
-- The four keep their existing ids, so every task already linked to them stays
-- linked. Only their visibility changes.

ALTER TABLE tracker.task_groups
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- Promote the four existing lanes. Matched on name so this is safe to re-run.
UPDATE tracker.task_groups
   SET is_shared = true,
       updated_at = NOW()
 WHERE name IN ('Yet to Start', 'In Progress', 'Completed', 'Production');

CREATE INDEX IF NOT EXISTS idx_task_groups_is_shared
  ON tracker.task_groups(is_shared);
