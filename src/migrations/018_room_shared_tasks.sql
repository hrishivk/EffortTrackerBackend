-- Migration: room shared tasks — ordering, sequencing and comments
--
-- Backs the "one main task, one subtask per room member, run in order, comment
-- on either" feature. Everything lives on tracker.tasks: NO new tables.
--
-- Run AFTER 015 (which added tasks.room_id) and 012/013 (parent_id, tags).
-- Every statement is guarded, so the file is safe to re-run.
--
-- ── Why this file is needed at all ───────────────────────────────────────────
--
-- dbConnection calls sequelize.sync() with NO `alter`, so sync() creates
-- missing TABLES but never adds a column to a table that already exists.
-- tracker.tasks has existed since day one, so declaring these four attributes
-- on the Task model is necessary but not sufficient — exactly the trap 008,
-- 014 and 015 each hit. Without this file every read below fails with
-- `column Task.position does not exist`.

-- ── 1. tasks.room_id ─────────────────────────────────────────────────────────
--
-- Already added by 015. Repeated here, fully guarded, because a database that
-- reached this point without 015 would otherwise take the whole feature down:
-- room_id is what makes a task "the room's" and what the §3 read rule scopes
-- on. On a database that ran 015 this whole block is a no-op.
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS room_id VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tasks_room_id'
      AND conrelid = 'tracker.tasks'::regclass
  ) THEN
    ALTER TABLE tracker.tasks
      ADD CONSTRAINT fk_tasks_room_id
      FOREIGN KEY (room_id) REFERENCES tracker.rooms(id) ON DELETE SET NULL;
  END IF;
END $$;

-- SET NULL, not CASCADE: deleting a room must not delete real work. Same
-- reasoning as group_id in 008.
CREATE INDEX IF NOT EXISTS tasks_room_id
  ON tracker.tasks(room_id) WHERE room_id IS NOT NULL;

-- ── 2. tasks.position ────────────────────────────────────────────────────────
--
-- Order of a child inside its parent. Only meaningful when parent_id is set; a
-- top-level task keeps 0 and nothing reads it.
--
-- NOT NULL DEFAULT 0 rather than nullable: the sequential rule in §4 compares
-- positions, and a NULL in that comparison would silently make a child
-- unblockable ("no sibling with a lower position") instead of ordering it.
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- ── 3. tasks.sequential ──────────────────────────────────────────────────────
--
-- Set on the PARENT. When true its children may only start in `position`
-- order. Default false, so every subtask that already exists keeps starting
-- whenever its owner likes — this migration changes no existing behaviour.
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS sequential BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 4. tasks.comments ────────────────────────────────────────────────────────
--
-- A JSONB array of comment objects on the task row itself. A subtask is
-- already a row in this table, so one column covers comments on the main task
-- AND on any subtask with no extra work.
--
-- jsonb, not json: the append/edit/delete writes are pure-SQL jsonb
-- expressions (`||`, jsonb_array_elements + jsonb_agg), which is what makes
-- three people commenting at the same moment safe. `json` has no such
-- operators and would force a read-modify-write in Node, which drops comments.
--
-- NOT NULL DEFAULT '[]' so every existing row is a valid empty array and the
-- `||` append never has to cope with NULL (NULL || anything is NULL, which
-- would silently swallow the first comment on every pre-existing task).
ALTER TABLE tracker.tasks
  ADD COLUMN IF NOT EXISTS comments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backstop against anything writing an object or a scalar into the column:
-- every reader below assumes an array and jsonb_array_elements() errors on
-- anything else.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_tasks_comments_array'
      AND conrelid = 'tracker.tasks'::regclass
  ) THEN
    ALTER TABLE tracker.tasks
      ADD CONSTRAINT chk_tasks_comments_array
      CHECK (jsonb_typeof(comments) = 'array');
  END IF;
END $$;

-- ── 5. Backfill position for subtasks that already exist ─────────────────────
--
-- /task-list has always ordered children by created_at. Leaving them all on 0
-- would make the new position sort arbitrary for every task created before
-- today, so seed position from the order they are currently displayed in.
--
-- Guarded on "every child of this parent is still 0" so re-running the file
-- cannot renumber a parent whose positions have since been set deliberately.
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at ASC) AS rn
    FROM tracker.tasks
   WHERE parent_id IS NOT NULL
     AND parent_id IN (
           SELECT parent_id
             FROM tracker.tasks
            WHERE parent_id IS NOT NULL
            GROUP BY parent_id
           HAVING MAX(position) = 0 AND MIN(position) = 0
         )
)
UPDATE tracker.tasks t
   SET position = ordered.rn
  FROM ordered
 WHERE t.id = ordered.id;

-- ── 6. Indexes ───────────────────────────────────────────────────────────────

-- The subtask read: children of one parent, in order. 012 already indexes
-- parent_id alone; this one lets the nested SELECT come back sorted without a
-- sort step, and it is the access path for the §4 sequential check ("is any
-- sibling with a lower position not yet completed").
CREATE INDEX IF NOT EXISTS idx_tasks_parent_position
  ON tracker.tasks(parent_id, position) WHERE parent_id IS NOT NULL;

-- The §3 read rule "a caller gets a parent when they are the assignee of ANY
-- of its subtasks" resolves as: my daily logs -> the children sitting in them
-- -> those children's parent_id. That lookup is by daily_log_id on rows that
-- have a parent, which this index serves.
CREATE INDEX IF NOT EXISTS idx_tasks_child_daily_log
  ON tracker.tasks(daily_log_id, parent_id) WHERE parent_id IS NOT NULL;
