# Database Migrations

Run these scripts in order against your PostgreSQL database.

## Execution Order

```bash
psql -U <username> -d <database> -f src/migrations/001_alter_projects_table.sql
psql -U <username> -d <database> -f src/migrations/002_create_project_members.sql
psql -U <username> -d <database> -f src/migrations/003_remove_users_project_id.sql
psql -U <username> -d <database> -f src/migrations/004_alter_tasks_table.sql
psql -U <username> -d <database> -f src/migrations/005_alter_daily_task_logs.sql
psql -U <username> -d <database> -f src/migrations/006_add_is_shared_to_users.sql
psql -U <username> -d <database> -f src/migrations/007_timestamps_to_timestamptz.sql
psql -U <username> -d <database> -f src/migrations/008_create_task_groups.sql
psql -U <username> -d <database> -f src/migrations/009_tasks_status_to_text.sql
psql -U <username> -d <database> -f src/migrations/010_task_planned_dates_and_time.sql
psql -U <username> -d <database> -f src/migrations/014_create_workspaces.sql
psql -U <username> -d <database> -f src/migrations/015_workspace_visibility_and_room_access.sql
psql -U <username> -d <database> -f src/migrations/016_room_members_allow_multi_room.sql
psql -U <username> -d <database> -f src/migrations/017_create_workspace_unlocks.sql
psql -U <username> -d <database> -f src/migrations/018_room_shared_tasks.sql
psql -U <username> -d <database> -f src/migrations/019_workspace_completion.sql
psql -U <username> -d <database> -f src/migrations/021_report_range_indexes.sql
psql -U <username> -d <database> -f src/migrations/022_create_task_extensions.sql
psql -U <username> -d <database> -f src/migrations/023_project_activity.sql
psql -U <username> -d <database> -f src/migrations/024_create_workspace_managers.sql
psql -U <username> -d <database> -f src/migrations/025_create_announcements.sql
psql -U <username> -d <database> -f src/migrations/026_announcements_allow_resend.sql
psql -U <username> -d <database> -f src/migrations/027_task_groups_hidden_and_room.sql
psql -U <username> -d <database> -f src/migrations/028_task_group_hides.sql
psql -U <username> -d <database> -f src/migrations/029_task_groups_marks_status.sql
psql -U <username> -d <database> -f src/migrations/030_task_groups_with_default_lanes.sql
psql -U <username> -d <database> -f src/migrations/031_org_view.sql
```

(011-013 and 020 are not described below; they were added without a README
entry.)

## What each migration does

1. **001** - Adds start_date, end_date, status, progress to projects
2. **002** - Creates project_members join table + migrates existing user→project data
3. **003** - Removes project_id column from users (after data migrated)
4. **004** - Replaces tasks.project (string) with tasks.project_id (FK), updates status enum
5. **005** - Adds project_id to daily_task_logs
6. **006** - Adds users.is_shared — a shared user (e.g. a tester working across
   every project) is visible to ALL managers, not only the one who created them
7. **007** - Converts naive `timestamp` columns to `timestamptz` across tasks,
   projects, users, domains and daily_task_logs. Fixes a -5h30m drift where
   node-postgres parsed naive values in the process's local timezone
8. **008** - Creates task_groups (a user-created board lane: name, color,
   position) and adds the nullable tasks.group_id FK with ON DELETE SET NULL, so
   deleting a group returns its tasks to their status lane instead of deleting
   real work. group_id must also be declared on the Task model — Sequelize only
   SELECTs declared attributes, so the column alone is invisible to reads and
   writes alike
9. **009** - Converts tasks.status from the `task_status` enum to VARCHAR(100)
   and drops the enum, so a task parked in a group carries that group's NAME in
   status ("production"). Groups named for a real status still normalise
   ("Completed" -> "completed"). Backfills already-grouped tasks. **Lossy**: the
   previous status of a grouped task is overwritten and unrecoverable, and
   super-admin completion metrics undercount any task in a non-status group
10. **010** - Adds start_date, due_date and total_seconds to tasks, and revives
   total_time. Separates the manager's PLAN (start_date/due_date) from the
   ACTUAL work (start_time/end_time), which previously collided: the form's Due
   Date was written into end_time, and completing a task overwrote it with
   NOW(), destroying the deadline. Backfills due_date from end_time for
   not-yet-completed tasks (copy, not move). total_time had existed as
   varchar(50) since day one but was never declared on the Sequelize model, so
   every row was NULL
11. **014** - Creates workspaces, rooms and room_members: the tree behind the
   Create Workspace wizard. A workspace covers one project (nullable FK, so it
   outlives a deleted project) and holds many rooms; a room holds many users.
   CASCADE downward, so deleting a workspace clears its rooms and assignments.
   Two unique constraints on room_members are load-bearing: (room_id, user_id)
   stops a double-add, and (workspace_id, user_id) is what makes the drag a
   MOVE rather than a duplicate — the denormalised workspace_id exists only so
   that second rule can be a database constraint. `status` is VARCHAR + CHECK
   rather than a PG enum, because 009 had to drop an enum to widen it

## Important

- Run 002 BEFORE 003 (data migration must happen before column removal)
- Back up your database before running migrations
- Sequelize `sync()` does NOT add columns to tables that already exist. Skipping
  006 produces `column User.is_shared does not exist` on every user query, and
  skipping 007 leaves timestamps 5h30m out on an IST host. Run them.
- 008 is the same trap: sync() creates the new task_groups table on its own but
  will NOT add group_id to the existing tasks table. Without it every board drop
  onto a group fails, and /task-list never returns the field the board buckets on
- 014 is a third variant of the same trap, and it has already bitten once:
  sync() creates the three new tables, their FKs and the unique indexes
  declared on the models, so a dev boot silently produced tables that LOOK
  complete. What it will not create is the two things that live only in the SQL
  — the `chk_workspaces_status` CHECK and the partial unique index on
  `UPPER(code)`, an expression index with a WHERE clause being outside what
  Sequelize can declare. Without them a bad status token reaches the column
  (the service still rejects it, so this is a backstop, not the only guard) and
  two workspaces can share one Workspace Key, which the frontend validates
  against before submit.
  Because of that, 014's statements are all written to be no-ops when sync()
  got there first: the plain indexes carry sync()'s own names
  (`workspaces_created_by`, not `idx_workspaces_created_by`) so `IF NOT EXISTS`
  matches instead of creating a second identical index, and the CHECK is added
  by a guarded `ALTER` rather than inline, since `CREATE TABLE IF NOT EXISTS`
  on an existing table skips the constraint with everything else. Re-running it
  is safe
- Migration 007 rewrites tables under an ACCESS EXCLUSIVE lock (brief on small
  tables). Its `AT TIME ZONE 'UTC'` clauses are load-bearing — removing them
  would silently shift every historical row. See comments in the file.

## Status

008 and 009 have been applied to the shared Lightsail database.
010 is written but NOT yet applied.

018 has been applied to the shared Lightsail database (2026-09-10, PostgreSQL
18.4). It was run inside a single transaction with the verification queries
before the COMMIT, so a failure would have rolled the whole thing back.

Why it could not wait: the Task model declares `position`, `sequential` and
`comments`, and Sequelize puts every declared attribute in its SELECT list. On
a database without 018 EVERY task read fails, not only the new ones — the first
symptom was `column "position" does not exist` thrown from
`closeOpenSessions` during **login**, so nobody could sign in.

State before the run: 762 rows in `tracker.tasks`, `room_id` already present
from 015, and **zero** rows with a `parent_id`. So the `position` backfill —
the only statement in the file that touches existing data — was a no-op here,
and the three `ADD COLUMN`s were metadata-only (non-volatile defaults, PG 11+).
Verified after commit: all four columns with the right defaults, both new
indexes, `chk_tasks_comments_array`, and all 762 rows holding a valid `[]`.

The three atomic comment statements were then verified against this schema in a
**rolled-back** transaction, the same way 014 was checked:

- two appends land as two elements, in order
- an edit by the author returns the updated element with `updated_at` set
- an edit by a non-author updates **0 rows**, and the sibling element's
  `updated_at` stays null — proof the statement rewrites only the targeted
  element and never the whole array
- a delete with `allow_any = TRUE` (the task's creator) removes the element; the
  same delete with `allow_any = FALSE` and the wrong `user_id` updates 0 rows
- deleting the last element yields `'[]'`, not NULL, so the next append still
  works
- the `findComment` lateral read returns 0 rows on an empty array
- the CHECK rejects a non-array

Re-running the whole file inside that transaction was a no-op, confirming the
guards. Finally, `Database.init()` was booted against the live database to
confirm `sync()` is a no-op and that the nested subtask read — including the
`dailyLog -> assignedUser` join and the `position` ordering — returns.

014 has been applied to the shared Lightsail database (2026-09-03). Note that
`sync()` had already created all three tables on a dev boot, so the migration's
CREATE TABLE statements were no-ops and it added only the two things sync()
cannot express: `chk_workspaces_status` and `uq_workspaces_code`. Verified with
inserts in a rolled-back transaction — a bad status token, a case-differing
duplicate code, and a user dropped into a second room of one workspace are all
rejected; two NULL codes are allowed.

006 and 007 have already been applied to the shared Lightsail database
(`ls-4993ad9e…` / `postgres`). New environments need the full 001-007 run.

15. **015** - The Round 2 / Round 3 follow-ups on workspaces, in one file:
    - `rooms.description` (the line under a room card's name)
    - `tasks.room_id` - nullable FK, `ON DELETE SET NULL`, so deleting a room
      keeps the work. This is what lets a room ask for *its* tasks instead of
      deriving them from "tasks on this project assigned to somebody in this
      room", a derivation that double-counts anyone in two rooms of one project
    - `workspaces.visibility` - `private` | `public`, CHECK-constrained,
      defaulting to `private`, with every pre-existing workspace backfilled to
      `private` rather than published by omission
    - `room_members.status` (`pending` | `active` | `rejected`) plus
      `requested_at`, `decided_by`, `decided_at`, for the join-request flow.
      Defaults to `active` because a manager placing someone in a room *is* the
      approval, which also backfills every existing row correctly
    - Replaces 014's strict `UNIQUE (workspace_id, user_id)` with a **partial**
      one on `status = 'active'`. The strict version was too strong once
      requests exist: an active member of one room must still be able to have a
      pending request for another, and a manager's drag would otherwise fail
      against a user who had a request outstanding
    - Drops a duplicate unique index on `room_members (room_id, user_id)` -
      `sync()` had created it as a constraint and 014's `CREATE UNIQUE INDEX IF
      NOT EXISTS` did not match that name, so both were being enforced

    Note this one **cannot** be skipped in favour of `sync()`. `dbConnection`
    calls `sequelize.sync()` with no `alter`, so it creates missing tables but
    never adds a column to an existing one - and all three workspace tables
    already existed.

16. **016** - Drops the "one room per workspace per user" constraint entirely,
    so a user can be in several rooms of one workspace.

    This reverses part of 014 and 015 on purpose. That rule existed because the
    wizard's drag was defined as a MOVE - dropping someone into a room removed
    them from their previous one. The frontend deliberately changed that: a drag
    now ADDS. The old constraint stopped being merely unnecessary and started
    actively blocking the new behaviour, with a unique violation on the second
    room.

    Dropped: `uq_room_members_active_workspace_user` (015's partial index), plus
    guarded drops of 014's strict `UNIQUE (workspace_id, user_id)` under either
    the index or the constraint name, for a database that reached this point by
    a different route.

    Kept: `UNIQUE (room_id, user_id)` - nobody twice in the same room, which is
    what makes a repeated add a no-op rather than an inflated count. Also kept
    is `room_members.workspace_id`; the constraint was its original reason to
    exist, but the approval queue and every non-SP visibility check now read
    through it.

    Expect per-room member counts to sum to more than the workspace's user
    count. Three people spread as 2 + 1 + 2 is five rows; the hero stat is
    `COUNT(DISTINCT user_id)` and correctly reports three.

17. **017** - Creates `workspace_unlocks`: "this login session typed the
    correct key for this workspace".

    Deliberately NOT a `room_members` row. The two facts have different
    lifetimes and grant different things - a manager's decision persists and
    grants rooms; a typed key dies with the session and grants only sight of
    the workspace shell. Recording an unlock as a membership would make the key
    permanent (so it would never be asked again) and would quietly add the
    person to a room's member list.

    `session_id` is the `sid` claim now minted into both JWTs at login and
    carried through every token refresh - auth is stateless and there was no
    session record to key on. It is not a FK for that reason. Rows go three
    ways: deleted by sid at logout, cascaded when the user or workspace goes,
    and swept after 16 hours (the refresh-token lifetime) for sessions that
    expired without a logout.

    `UNIQUE (session_id, workspace_id)` makes re-entering the key a no-op. The
    read index carries `user_id` as well, so a guessed or replayed sid is worth
    nothing on its own.

18. **018** - Room shared tasks: one main task, one subtask per room member,
    run in order, with comments on either. Four columns on `tasks`, no new
    tables. Full API contract in `docs/room-shared-tasks-api.md`.

    - `position` - `INTEGER NOT NULL DEFAULT 0`, the order of a child inside
      its parent. NOT NULL rather than nullable on purpose: the ordering rule
      compares positions, and a NULL in that comparison makes a child look like
      it has no predecessor and start out of turn instead of being ordered
    - `sequential` - `BOOLEAN NOT NULL DEFAULT FALSE`, set on the PARENT. When
      true its children may only start in `position` order. Default false, so
      every task that already exists keeps letting its children start freely
    - `comments` - `JSONB NOT NULL DEFAULT '[]'` with
      `CHECK (jsonb_typeof(comments) = 'array')`. A subtask is already a row in
      this table, so one column covers comments on a main task and on a single
      subtask alike. `jsonb` not `json` because every write is a pure-SQL
      expression (`||` to append, `jsonb_agg` over `jsonb_array_elements` to
      edit or delete) - `json` has neither, which would force a
      read-modify-write in Node and silently drop comments when two land in the
      same moment. NOT NULL DEFAULT `'[]'` is load-bearing too: `NULL || x` is
      NULL, which would have swallowed the first comment on every pre-existing
      task
    - `room_id` - already added by 015. Repeated here, fully guarded, because a
      database that reached this point without 015 would otherwise lose the
      whole feature: `room_id` is what makes a task the room's, and what the
      new read rule scopes on. On a database that ran 015 the block is a no-op
    - Backfills `position` for subtasks that already exist, seeded from the
      `created_at` order the board has always drawn them in - otherwise every
      pre-existing parent would have all its children on 0 and the new sort
      would be arbitrary. Guarded to parents whose children are ALL still 0, so
      re-running the file cannot renumber positions set deliberately
    - Two indexes: `(parent_id, position)` for the ordered child read and the
      sequential check, and `(daily_log_id, parent_id)` for the new read rule
      "a caller gets a parent when they are the assignee of any of its
      subtasks", which resolves as my logs -> the children in them -> their
      `parent_id`

    Note that this one **cannot** be skipped in favour of `sync()`, and the
    failure is total rather than partial. `dbConnection` calls
    `sequelize.sync()` with no `alter`, so it creates missing tables but never
    adds a column to an existing one - and `tasks` has existed since day one.
    The Task model now declares all four attributes, and Sequelize only SELECTs
    declared attributes, so until this file runs EVERY task read fails with
    `column Task.position does not exist`. Same trap as 008, 014 and 015.

    Every statement is guarded and the file is safe to re-run.

    Assignment deliberately did NOT become a column here. It stays on
    `daily_task_logs (created_by, assigned_to)`, so "each subtask assigned to a
    different room member" is implemented as "each subtask row attached to its
    own assignee's daily log". A new `tasks.assigned_to` would have created a
    second source of truth for assignment, which the board, the session timer,
    day locking, the login carry-over and the super-admin metrics all read from
    the log today.

    `is_blocked` and `blocked_by` are also deliberately NOT columns - they are
    computed at read time from the siblings' statuses, because a stored copy is
    stale the moment somebody else's subtask completes.

19. **019** - Workspace completion: the "mark completed and tell a manager"
    button next to the workspace status.

    - Widens `chk_workspaces_status` to allow **`completed`**. Until this ran
      the only legal statuses were `planning | active | on_hold`, so there was
      no way to record that a workspace was finished and the button had nothing
      to write. This is exactly the case 014 chose VARCHAR + CHECK over a PG
      enum for - its comment reads "009 had to drop the task_status enum to
      widen it; a CHECK constraint is one ALTER away instead". This is that
      ALTER. Dropped and re-added rather than altered in place, since a CHECK
      has no ALTER ... MODIFY form; both statements sit inside the file's
      transaction, so no committed reader ever sees the table unconstrained
    - `completed_at` - TIMESTAMPTZ, nullable, and NULL is meaningful: it means
      "not completed". The badge beside the status renders off it, which
      `updated_at` cannot stand in for because that moves on every edit
    - `completed_by` - FK to users, `ON DELETE SET NULL`. A completion outlives
      the person who recorded it, same rule as `room_members.decided_by`
    - Partial index on `completed_at` for the "completed workspaces" filter

    Both columns are derived by the SERVICE, never accepted from a caller - a
    client that could set them could backdate a completion or credit someone
    else. They are kept strictly in step with `status`: moving to `completed`
    stamps them, moving away nulls them, and re-completing an already-completed
    workspace leaves the original stamp alone. So a reopened workspace can never
    still carry a completion date.

    `completed` is a fourth STATUS rather than a separate boolean flag on
    purpose: a workspace is in exactly one state, and a flag beside the status
    would permit the contradiction of "on_hold and also complete".

    No backfill, deliberately: no workspace could have been `completed` before
    this file ran, so there is nothing to date, and inventing a `completed_at`
    for a planning or active workspace would be a lie.

    The notification needs no schema - `notifications` already takes an
    arbitrary `type` string. The new type is `workspace_completed`, with the
    WORKSPACE id as `reference_id`.

    Applied to the shared Lightsail database (2026-09-11). Dry-run first in a
    rolled-back transaction, which confirmed: the CHECK gains `completed`,
    `status = 'completed'` is accepted, a bogus token (`'finished'`) is still
    refused, both columns and the FK and the index appear, and re-running the
    whole file is a no-op. Then committed in a second transaction with the same
    assertions before COMMIT. The one existing workspace was `active` before and
    after - nothing was completed by the migration itself.

20. **021** - Read-path indexes for date-ranged reads. Added alongside the
    `from`/`to` window on `GET /task-list` and the two report routes, which
    both ask the same question: the tasks sitting in these people's daily logs
    between these two dates. Nothing on either table answered it.

    - `daily_task_logs` carried its **primary key and nothing else** - not
      `date`, not `assigned_to` - so every windowed read was a sequential scan
      of the whole table. Adds `(assigned_to, date)`, `(created_by, date)` and
      `(date)`. The first two are the two OR branches of `findDailyLogs`,
      which Postgres plans separately; the third serves `logIdsForWindow`,
      the room-wide read rule, which filters on date alone
    - `tasks(daily_log_id)` - `daily_log_id` appeared only inside
      `idx_tasks_child_daily_log`, which is PARTIAL (`WHERE parent_id IS NOT
      NULL`) and so cannot serve a join that has to reach parents too. A
      report counts parents and subtasks alike
    - `tasks(project_id)` - declared by 004 but absent from the live database.
      Backs `?project_id=` on both report routes

    Read path only: no column changes, no data rewritten, `IF NOT EXISTS`
    throughout, so re-running is a no-op. **Not yet applied to the shared
    Lightsail database.** (005's `idx_daily_task_logs_project_id` is also
    missing there - worth a look, but out of this migration's scope.)

22. **022** - Creates `task_extensions`: one row per recorded push of a task's
    deadline, carrying `previous_due_date`, `new_due_date`, a NOT NULL `reason`
    and `extended_by`.

    A deadline that moves is an **event**, not a new value. Editing
    `tasks.due_date` on its own answers "when is it due"; it cannot answer
    "how many times has this slipped, from what, and why".

    A table rather than a JSONB column on `tasks`, unlike `tasks.comments`:
    these rows are queried ACROSS tasks (the `?extended=true` board filter),
    and a jsonb array cannot be counted or filtered without unnesting every
    task on the board. Comments are only ever read back with their own task,
    which is why they stayed on the row.

    `previous_due_date` is nullable - a task with no due date can still be
    given one, and that first push is a real extension with nothing to have
    moved from. `extended_by` has **no FK**: users get deleted, and losing a
    task's whole slip history because the person who extended it left would
    destroy the record the table exists to keep. The name is resolved on read,
    the same way task comments resolve theirs.

    **Not yet applied to the shared Lightsail database.**

23. **023** - Adds `projects.activity` (JSONB, NOT NULL DEFAULT `'[]'`): an
    append-only history of everything that happens to a project - `created`,
    `renamed`, `status_changed`, `due_date_changed`, `extended`, `updated`,
    `member_added`, `member_removed` - each entry carrying the field, the old
    and new values, the actor and, for an extension, the reason.

    Editing a project overwrote the row in place, so moving an end date erased
    the old one and left no record of who moved it or why. `created_by` and
    `created_at` were the only history a project had.

    A **column, not a table**, unlike `task_extensions` (022), and the
    difference is deliberate: extensions are queried ACROSS tasks
    (`/task-list?extended=true`), which a jsonb array cannot serve without
    unnesting the whole table. Project activity is only ever read one project
    at a time, and the "Extended N times" badge is the array's length. So this
    follows the `tasks.comments` pattern - same shape of data, same access
    path. If a cross-project filter is ever wanted, `jsonb_array_elements` over
    ten projects migrates it into a table in one script.

    **Every write must go through the pure-SQL append**
    (`activity = activity || CAST(:elements AS jsonb)`, see
    `appendProjectActivity`), never a read-modify-write in Node - two managers
    saving the same project in the same moment would otherwise drop each
    other's entries. Same rule `tasks.comments` follows.

    **Not yet applied to the shared Lightsail database.**

24. **024** - Creates `workspace_managers` (`workspace_id`, `user_id`,
    `assigned_by`, `created_at`; primary key `(workspace_id, user_id)`, index
    on `user_id`): AMs the creator has assigned to a workspace they did not
    create. An assigned AM gets the creator's rights (no key, every room,
    edit, rooms and members, complete) except deleting the workspace and
    assigning or removing managers, which stay creator-or-SP only.

    **Not yet applied to the shared Lightsail database.**

25. **025** - Creates `announcements` (`id`, `version` UNIQUE, `title`,
    `message` nullable, `created_by` -> users ON DELETE SET NULL,
    `created_at`; index on `created_at`). Backs SP's "Notify everyone" on the
    What's New page: `POST /role-user/announcements` saves one row and fans out
    a `release_announcement` notification (reference_id = announcement id) to
    every non-blocked AM, MG, USER and DEVLOPER; `GET
    /role-user/announcements/latest` feeds the banner. The unique version is
    what turned a second send of the same release into a 409 (dropped by
    026).

    The table already exists on the shared Lightsail database (created by the
    app's startup `sync()`), so this script is a no-op there.

26. **026** - Drops the UNIQUE on `announcements.version` (from 025) and adds
    an index on `(version, created_at DESC)`. SP can announce the same
    release again at any time; every `POST /role-user/announcements` saves a
    new row and notifies everyone again.

    **Applied to the shared Lightsail database on 2026-10-09.** On any other
    database, run it before deploying this code: until it runs, a re-send hits
    the old constraint and fails with a 500 `"Validation error"`.

27. **027** - Adds `task_groups.hidden` (BOOLEAN, default false) and the
    nullable `task_groups.room_id` (FK to rooms, ON DELETE CASCADE). NULL is
    the user's own board outside any room, which is every existing lane, so no
    data moves. Replaces the unique `(user_id, name)` with two partial unique
    indexes, one per board kind, so the same lane name can exist on a user's
    own board and in each of their rooms.

    **Not yet applied anywhere.** Run it BEFORE deploying this code: the
    app's startup `sync()` builds the model's indexes on `room_id`, so a
    server started first fails on the missing column.

28. **028** - Creates `task_group_hides` (`group_id`, `user_id`, nullable
    `room_id`, all ON DELETE CASCADE; one row per lane per board via two
    partial unique indexes). Hiding a lane is now per user, per board:
    `PATCH /task-groups?id=` with `{ hidden, assigned_to?, room_id? }` writes
    or removes a row here instead of flagging the lane, so a USER/DEVLOPER can
    hide a SHARED lane (Yet to Start / In Progress / Completed) on their own
    board or in one room without hiding it for anyone else. `GET
    /task-groups` reports `hidden` per board; 027's `task_groups.hidden` is
    still honoured on read. No task is touched.

    **Applied to the shared database on 2026-10-15** (the table had already
    been created there by the app's startup `sync()`; the script added nothing
    new). It is additive; on any other database `sync()` also creates it.

29. **029** - Adds the nullable `task_groups.marks_status` (`in_progress` or
    `completed`). A card moved into a lane with it set takes that status — a
    "Done" lane created with marks_status = completed completes the card, so
    it is not carried over. NULL (every existing lane) keeps the old rule: a
    custom lane leaves the card's status alone. The usual transition rules
    still apply (a never-started task cannot be completed by a drop).
    `POST /task-groups` and `PATCH /task-groups?id=` accept `marks_status`.

    **Applied to the shared database on 2026-10-15.** On any other database,
    run it BEFORE starting this code: `sync()` does not add columns to an
    existing table, and every task-group query selects `marks_status`.

30. **030** - Adds `task_groups.with_default_lanes` (BOOLEAN, default
    false). A user's group created with "Add after the 4 lanes" has it true
    and shows after Yet to Start, In Progress, Completed and Production; the
    others (false, every existing group) show only with "Use only my groups".
    `POST /task-groups` accepts `with_default_lanes`.

    **Applied to the shared database on 2026-10-15.** On any other database,
    run it BEFORE starting this code: `sync()` does not add columns to an
    existing table, and every task-group query selects `with_default_lanes`.

31. **031** - The org view (docs/org-view-api.md). Adds `users.domain_id`
    (primary department, FK -> domains, SET NULL), `domains.head_user_id`
    (FK -> users, SET NULL), `domains.parent_id` (FK -> domains, SET NULL, plus
    a not-self CHECK) and `domains.sort_order` (INT, default 0), and gives
    `users.manager_id` its foreign key (SET NULL). Before that FK it clears
    only the manager_id values it would reject — blanks, self-references and
    ids of deleted users. Every VALID manager_id is left alone, because leave
    approval, AM team scoping and reports all route through it.
    Backfills `users.domain_id` from the `department` string (case and
    surrounding spaces ignored), then, for a non-shared user still unmatched,
    from their single domain_assignments link if they have exactly one.
    Whoever is left is listed by the view `tracker.users_without_department`
    for an admin to fix in the app. Indexes users(domain_id),
    users(manager_id), domains(parent_id), tasks(daily_log_id, status) and
    tasks(due_date).

    **Not yet applied.** Run it BEFORE starting this code: `sync()` does not
    add columns to an existing table, and every users and domains query
    selects the new columns.
