-- Migration: mark tasks created by the Excel import
--
-- Run BEFORE deploying the code that declares `imported` on the Task model.
-- Sequelize SELECTs every declared attribute, so that code on a database
-- without this column fails every read of tasks.
--
-- An imported task that has a room shows only on that room's board: the
-- task list leaves it out of My Tasks and General (any request without a
-- room_id). Existing rows stay false, so nothing already on a board moves.
--
-- Re-running is safe: IF NOT EXISTS.

BEGIN;

ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS imported BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
