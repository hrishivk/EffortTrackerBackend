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
```

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

## Important

- Run 002 BEFORE 003 (data migration must happen before column removal)
- Back up your database before running migrations
- Sequelize `sync()` does NOT add columns to tables that already exist. Skipping
  006 produces `column User.is_shared does not exist` on every user query, and
  skipping 007 leaves timestamps 5h30m out on an IST host. Run them.
- Migration 007 rewrites tables under an ACCESS EXCLUSIVE lock (brief on small
  tables). Its `AT TIME ZONE 'UTC'` clauses are load-bearing — removing them
  would silently shift every historical row. See comments in the file.

## Status

006 and 007 have already been applied to the shared Lightsail database
(`ls-4993ad9e…` / `postgres`). New environments need the full 001-007 run.
