-- Migration: per-room task groups, and hiding a lane
--
-- Run AFTER 026.
--
-- hidden: a lane the owner has hidden from their board. Hiding is display
-- only — tasks keep their group_id and status, and the lane comes back with
-- them when it is shown again.
--
-- room_id: which board the lane belongs to. NULL is the user's own board
-- outside any room, which is every lane that exists today, so nothing moves.
-- The same user can then keep "Yet to Start" on their own board and hide it in
-- one room without touching any other board.
--
-- CASCADE: a room's lanes go with the room. Its tasks survive, because
-- tasks.group_id is ON DELETE SET NULL (008).
ALTER TABLE tracker.task_groups
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tracker.task_groups
  ADD COLUMN IF NOT EXISTS room_id VARCHAR(20)
    REFERENCES tracker.rooms(id) ON DELETE CASCADE;

-- Names were unique per user; they are now unique per user PER BOARD. A plain
-- UNIQUE (user_id, room_id, name) would not do it: Postgres treats NULLs as
-- distinct, so two own-board lanes with the same name would both get in. Two
-- partial indexes instead, one for each kind of board.
--
-- uq_task_groups_user_name is 008's constraint; task_groups_user_id_name is
-- the index sequelize.sync() builds from the model's old `unique` entry. Both
-- go — sync() never drops an index by itself.
ALTER TABLE tracker.task_groups
  DROP CONSTRAINT IF EXISTS uq_task_groups_user_name;
DROP INDEX IF EXISTS tracker.task_groups_user_id_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_groups_own_board_name
  ON tracker.task_groups(user_id, name)
  WHERE room_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_groups_room_board_name
  ON tracker.task_groups(user_id, room_id, name)
  WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_groups_room_id
  ON tracker.task_groups(room_id);
