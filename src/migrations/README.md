# Database Migrations

Run these scripts in order against your PostgreSQL database.

## Execution Order

```bash
psql -U <username> -d <database> -f src/migrations/001_alter_projects_table.sql
psql -U <username> -d <database> -f src/migrations/002_create_project_members.sql
psql -U <username> -d <database> -f src/migrations/003_remove_users_project_id.sql
psql -U <username> -d <database> -f src/migrations/004_alter_tasks_table.sql
psql -U <username> -d <database> -f src/migrations/005_alter_daily_task_logs.sql
```

## What each migration does

1. **001** - Adds start_date, end_date, status, progress to projects
2. **002** - Creates project_members join table + migrates existing user→project data
3. **003** - Removes project_id column from users (after data migrated)
4. **004** - Replaces tasks.project (string) with tasks.project_id (FK), updates status enum
5. **005** - Adds project_id to daily_task_logs

## Important

- Run 002 BEFORE 003 (data migration must happen before column removal)
- Back up your database before running migrations
- Sequelize `sync({ alter: true })` will also handle most of these changes automatically
