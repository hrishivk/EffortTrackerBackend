-- Migration: hide a lane per user, per board
--
-- Run AFTER 027.
--
-- 027's task_groups.hidden is a flag on the lane row. That works for a lane
-- owned by one board, but Yet to Start / In Progress / Completed are SHARED
-- lanes (011): one row drawn on every board, so flagging it would hide it for
-- everybody — and a USER or DEVLOPER may not change a shared row at all.
--
-- This table records "user X hid lane G on this board" instead. room_id NULL
-- is the user's own board outside any room. Display only: tasks keep their
-- group_id and status. task_groups.hidden is still honoured when reading, so
-- lanes hidden through 027 stay hidden.
--
-- CASCADE on all three: the hide goes with the lane, the user or the room.
CREATE TABLE IF NOT EXISTS tracker.task_group_hides (
  id VARCHAR(20) PRIMARY KEY,
  group_id VARCHAR(20) NOT NULL
    REFERENCES tracker.task_groups(id) ON DELETE CASCADE,
  user_id VARCHAR(20) NOT NULL
    REFERENCES tracker.users(id) ON DELETE CASCADE,
  room_id VARCHAR(20)
    REFERENCES tracker.rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One row per lane per board. Two partial indexes, not one UNIQUE: Postgres
-- treats NULLs as distinct, so own-board rows (room_id NULL) would duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_group_hides_own_board
  ON tracker.task_group_hides(group_id, user_id)
  WHERE room_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_group_hides_room_board
  ON tracker.task_group_hides(group_id, user_id, room_id)
  WHERE room_id IS NOT NULL;

-- The read path: "which lanes has this user hidden on this board".
CREATE INDEX IF NOT EXISTS idx_task_group_hides_board
  ON tracker.task_group_hides(user_id, room_id);
