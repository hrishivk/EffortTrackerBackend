-- Migration: groups shown after the 4 default lanes
--
-- Run AFTER 029.
--
-- A user's own group belongs to one of two sets on their board:
-- - with_default_lanes = true: created with "Add after the 4 lanes"; it shows
--   after Yet to Start, In Progress, Completed and Production;
-- - false (every existing group): created with "Use only my groups"; it shows
--   only when the board is switched to the user's own groups.
--
-- Additive: existing groups keep today's behaviour.
ALTER TABLE tracker.task_groups
  ADD COLUMN IF NOT EXISTS with_default_lanes BOOLEAN NOT NULL DEFAULT false;
