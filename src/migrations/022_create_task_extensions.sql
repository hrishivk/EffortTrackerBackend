-- Migration: task extensions
--
-- A deadline that moves is an EVENT, not a new value. Editing tasks.due_date
-- on its own answers "when is it due"; it cannot answer "how many times has
-- this slipped, from what, and why", which is the question a manager actually
-- asks. One row per push keeps the whole chain: 21st -> 25th -> 30th, with a
-- reason against each hop.
--
-- A table rather than a JSONB column on tasks, unlike tasks.comments: these
-- rows are QUERIED across tasks (§4's "show me everything that slipped"), and
-- a jsonb array cannot be counted or filtered without unnesting every task in
-- the board. Comments are only ever read back with their own task, which is
-- why they stayed on the row.
--
-- reason is NOT NULL with no default. The point of the feature is the why, so
-- a nullable column would let the one field that justifies the table be left
-- empty.

CREATE TABLE IF NOT EXISTS tracker.task_extensions (
  id                VARCHAR(20)  PRIMARY KEY,

  -- ON DELETE CASCADE, like task comments and subtasks: the history of a task
  -- that no longer exists has nothing to hang from. Deleting a parent task
  -- already cascades to its subtasks, and each of those clears its own
  -- extensions the same way.
  task_id           VARCHAR(20)  NOT NULL
                      REFERENCES tracker.tasks(id) ON DELETE CASCADE,

  -- NULLABLE on purpose. A task with no due date at all can still be given
  -- one, and that first push is a real extension with a real reason — it just
  -- has nothing to have moved FROM. Forcing a value here would mean inventing
  -- one.
  previous_due_date DATE,
  new_due_date      DATE         NOT NULL,

  reason            TEXT         NOT NULL,

  -- No FK: users are deleted from this system, and losing the whole extension
  -- history of a task because the person who extended it left would destroy
  -- the record this table exists to keep. The name is resolved on read, the
  -- same way task comments resolve theirs.
  extended_by       VARCHAR(20),

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Every read is "the extensions of these tasks, oldest first", so the index
-- carries the sort as well as the lookup.
CREATE INDEX IF NOT EXISTS idx_task_extensions_task_id
  ON tracker.task_extensions(task_id, created_at);

-- Backs the manager filter: ?extended=true / ?min_extensions=N group by task.
CREATE INDEX IF NOT EXISTS idx_task_extensions_extended_by
  ON tracker.task_extensions(extended_by);
