# Org View API

Backend for the SuperAdmin (CEO) panel's organisation view, built to
*Krew – Org View Backend Requirements* (Nov 26, 2026). The view drills down:
company → department → manager → employee → tasks, one call per level.

**Deploy order:** run `src/migrations/031_org_view.sql` first, then deploy the
code. The models declare the new columns, and `sync()` does not add columns, so
the code on an unmigrated database fails every users/domains read.

Every response uses the usual `{ success, message, data }` envelope. Dates are
`YYYY-MM-DD`; a range is `from` + `to`, both or neither (a half-sent range is a
**400**), inclusive at both ends, at most 366 days — the same rules as
`task-list`.

---

## Data model (migration 031)

| Table | Column | Notes |
|---|---|---|
| `users` | `domain_id` | Primary department. FK → `domains.id`, nullable, indexed, `ON DELETE SET NULL`. The `department` string stays and is still written. |
| `users` | `manager_id` | Now a real FK → `users.id`, indexed, `ON DELETE SET NULL`. Cycles are rejected on edit. |
| `domains` | `head_user_id` | FK → `users.id`, nullable, `ON DELETE SET NULL`. Must belong to the department. |
| `domains` | `parent_id` | FK → `domains.id`, nullable, `ON DELETE SET NULL` (a deleted parent lifts its children to the top). Loops rejected. |
| `domains` | `sort_order` | INT, default 0. Tree order: `sort_order`, then name. |

**Who is in a department:** everyone whose `domain_id` is it, plus every
**shared** user (`is_shared = true`) linked to it through `domain_assignments` —
they appear under every department they are linked to. SP is the company, not a
member of any department. Blocked users are included and flagged
`isBlocked: true`.

**Unmatched users after the backfill:**

```sql
SELECT * FROM tracker.users_without_department;
```

### Definitions used everywhere

| Figure | Rule |
|---|---|
| A person's tasks | Tasks whose **daily log** is assigned to them, with `daily_task_logs.date` in the window — the same rule as the reports. Parents and subtasks both count. |
| `overdue` | `due_date` before today and status not `completed`. |
| `efficiency` | `completed / total × 100` — the formula `team-performance` already used, so every screen agrees. |
| `onTimeRate` | Of completed tasks that had a `due_date`, the share whose `end_time` date is on or before it. |
| `hoursLogged` | Sum of `tasks.total_seconds` as `"HHH:MM"` (hours not capped at 24). |
| `isOnline` | `lastSeenAt IS NULL`. The login path sets it to NULL and logout stamps the time, so NULL means signed in. No session tracking was added. |
| `avatar` | Always `null` — there is no avatar column yet (same placeholder as `user-details`). |

---

## Access

| Role | Rule |
|---|---|
| SP | Every department and every person. |
| AM | Only departments they are linked to through `domain_assignments` (the rule `list-domains` already applies). A `domain_id` outside that set is **403**, never an empty list. `employee-summary` also allows their own direct reports and themselves. |
| USER / DEVLOPER / MG | **403** on every endpoint below (route guard). |

Errors: **400** bad params / dates, **403** out of scope, **404** unknown
department or user.

---

## New endpoints

### 1. `GET /role-sp/org-tree?from=&to=`

Default window: **today**. Cached for 60 s per caller and window.

```jsonc
{
  "range": { "from": "2026-11-26", "to": "2026-11-26" },
  "company": {
    "name": "RhythmRx", "employees": 84, "departments": 7,
    "tasks": { "total": 412, "completed": 260, "inProgress": 98, "overdue": 21 }
  },
  "departments": [
    {
      "id": "d1", "name": "Engineering", "parentId": null, "sortOrder": 0,
      "head": { "id": "u1", "fullName": "…", "avatar": null, "jobTitle": "CTO" },
      "employees": 22, "activeProjects": 6,
      "tasks": { "total": 140, "completed": 90, "inProgress": 35, "blocked": 4, "overdue": 7 },
      "completion": 64, "hoursLogged": "312:40",
      "managers": [
        { "id": "u2", "fullName": "…", "role": "AM", "jobTitle": "…", "avatar": null,
          "reports": [
            { "id": "u5", "fullName": "…", "role": "USER", "jobTitle": "…", "avatar": null,
              "tasksOpen": 5, "overdue": 1, "isOnline": true, "isBlocked": false }
          ] }
      ],
      "unassigned": [],
      "children": [ /* sub-departments, same shape */ ]
    }
  ]
}
```

- `managers` groups the department's people by `manager_id`. The manager may sit
  outside the department (another department's AM, or the SP) and still heads
  the group, so nobody drops out.
- `unassigned` is everyone with no (valid) `manager_id`.
- A department whose parent the caller cannot see is returned at the top level.
- For an AM, `company` totals cover only the people in their departments.

> Existing data: every user's `manager_id` was set to **whoever created them**,
> so until admins set real reporting managers, SP-created users show under the
> SP and AM-created users under that AM.

### 2. `GET /role-sp/department-overview?domain_id=&from=&to=`

`domain_id` required. Default window: **the last 30 days** (the trend needs more
than one point).

```jsonc
{
  "range": { "from": "2026-10-28", "to": "2026-11-26" },
  "department": { "id": "d1", "name": "Engineering", "description": "…", "parentId": null,
                  "head": { "id": "u1", "fullName": "…", "avatar": null, "jobTitle": "CTO" } },
  "tiles": { "employees": 22, "activeProjects": 6, "tasksTotal": 140, "completion": 64,
             "overdue": 7, "hoursLogged": "312:40", "onTimeRate": 88 },
  "status": { "yetToStart": 11, "inProgress": 35, "completed": 90, "blocked": 4 },
  "priority": { "High": 20, "Medium": 80, "Low": 40 },
  "trend": [ { "date": "2026-11-01", "created": 6, "completed": 5 } ],
  "projects": [ { "id": "p1", "name": "…", "status": "active", "progress": 72,
                  "dueDate": "2026-12-15", "members": 5 } ],
  "topPerformers": [ { "id": "u5", "fullName": "…", "completed": 18, "efficiency": 94 } ],
  "upcomingDeadlines": [ { "task": "…", "project": "…", "dueDate": "2026-11-28", "daysLeft": 2 } ],
  "recentActivity": [ { "user": "…", "action": "completed", "task": "…", "time": "…" } ]
}
```

- `trend` has one point per day of the window, zero-filled. `created` is by the
  task's `created_at` date, `completed` by its `end_time` date.
- `projects` are the projects whose `domain_id` is this department.
- `topPerformers`: top 5 by completed, then efficiency; only people with tasks.
- `upcomingDeadlines` / `recentActivity`: the item shapes of the existing
  `/role-sp/upcoming-deadlines` and `/role-sp/recent-activity`, 10 each.

### 3. `GET /role-sp/department-members?domain_id=&from=&to=&search=&role=&page=&limit=&sort=`

Default window **today**; `page` 1, `limit` 20 (max 100). `search` matches name
or email; `role` is exact (`AM`, `USER`, …). `sort` is `name` (default),
`overdue`, `completed`, `efficiency` or `lastSeen`, `-` prefix for descending.

```jsonc
{
  "users": [
    { "id": "u5", "fullName": "…", "email": "…", "role": "USER", "jobTitle": "…",
      "employeeId": "…", "avatar": null, "domainId": "d1",
      "managerId": "u2", "managerName": "…", "isShared": false, "isBlocked": false,
      "lastSeenAt": null, "isOnline": true,
      "workload": { "total": 9, "yetToStart": 2, "inProgress": 3, "completed": 4,
                    "blocked": 0, "overdue": 1, "hoursLogged": "31:20", "efficiency": 87 },
      "runningTask": { "id": "t9", "description": "…", "startedAt": "2026-11-26T04:12:00Z" } }
  ],
  "totalRecords": 22, "totalPages": 2, "currentPage": 1
}
```

`runningTask` is `null` when the person has no timer running (not bounded by the
window — a timer is live now or not).

### 4. `GET /role-sp/department-tasks?domain_id=&from=&to=&status=&priority=&assigned_to=&project_id=&overdue=&page=&limit=`

Default window **today**; `page` 1, `limit` 20 (max 100).

```jsonc
{
  "tasks": [ /* exactly the task-list item: assignedUser (now with domain_id),
                project, group, room, subtasks, extensions, comments … */ ],
  "meta": { "total": 140, "yetToStart": 11, "inProgress": 35, "completed": 90,
            "blocked": 4, "overdue": 7 },
  "totalRecords": 140, "totalPages": 7, "currentPage": 1
}
```

- Top-level tasks only; subtasks come nested, as on `task-list`.
- `status`: one or comma-separated, matched like `task-list`.
- `priority`: `High`, `Medium` or `Low` (any case).
- `assigned_to` outside the department returns an empty page.
- `overdue=true`: only tasks past `due_date` and not completed.
- `meta` counts the **whole filtered set** (every page), with every filter
  except `status` applied, so the status tabs keep their counts when one is
  selected.

### 5. `GET /role-sp/employee-summary?user_id=&from=&to=`

Default window: **the last 30 days**.

```jsonc
{
  "range": { "from": "2026-10-28", "to": "2026-11-26" },
  "user": { "id": "u5", "fullName": "…", "jobTitle": "…", "role": "USER",
            "department": { "id": "d1", "name": "Engineering" },
            "manager": { "id": "u2", "fullName": "…" },
            "joiningDate": "2025-04-01", "avatar": null,
            "isBlocked": false, "isOnline": true, "lastSeenAt": null },
  "kpis": { "assigned": 32, "completed": 25, "overdue": 2, "onTimeRate": 91,
            "efficiency": 78, "hoursLogged": "120:15", "avgHoursPerDay": "06:30",
            "extensions": 3 },
  "trend": [ { "date": "2026-11-01", "completed": 2, "hours": "07:10" } ],
  "projects": [ { "id": "p1", "name": "…", "tasksOpen": 3 } ]
}
```

- `avgHoursPerDay` averages over days that have logged time, so weekends do not
  halve it.
- `extensions`: deadline pushes recorded on their tasks in the window.
- `projects`: their project memberships, each with their open tasks on it.

---

## Existing endpoints that gained a department filter

All new parameters are optional. **Without them every endpoint answers exactly
as before.** A `domain_id` gets the access rules above (403 / 404).

| Endpoint | New params | Also changed |
|---|---|---|
| `GET /role-sp/list-users` | `domain_id`, `manager_id` (direct reports of) | Every row adds `domain_id`, `domainName`, `manager_id`, `managerName`, `jobTitle`, `avatar`. |
| `GET /role-user/task-list` | `domain_id` | `assignedUser` now carries `domain_id`. |
| `GET /role-sp/task-count` | `domain_id`, `from`, `to` | Adds `overdue`. |
| `GET /role-sp/project-stats` | `domain_id` | — |
| `GET /role-sp/recent-activity` | `domain_id` (`limit` existed) | — |
| `GET /role-sp/upcoming-deadlines` | `domain_id` (`limit` existed) | — |
| `GET /role-sp/team-performance` | `domain_id`, `from`, `to` | Each row adds `overdue` and `onTimeRate`. |
| `GET /{prefix}/reports/team` | `domain_id` (alias of the existing `department_id`) | An AM outside the department now gets 403. The department set now also includes primary members. |
| `GET /role-sp/list-domains` | — | Each row adds `parentId`, `head`, `employeeCount`, `activeProjectCount` (and the raw `parent_id`, `head_user_id`, `sort_order`). |
| `POST /role-sp/domain` | `parent_id`, `head_user_id`, `sort_order` (camelCase accepted) | Head must belong to the department (primary member, linked, or linked in the same request). Parent must exist and not create a loop. Omitted keys are left untouched; `null`/`""` clears. |
| `POST /role-sp/add-user`, `PATCH /role-sp/edit-user` | `domain_id` (`domainId`); `manager_id` already accepted | An AM may only use their own departments. `manager_id` loops are rejected. |
| `GET /role-sp/user-details` | — | Adds `domain_id`, `domainName`, `managerName`. |

### add-user / edit-user and the `department` string

- `domain_id` sent: validated, and `department` is set to that department's name
  unless the form sent its own.
- Only `department` sent (the web portal today): `domain_id` is matched from the
  name, case and spaces ignored. On edit this happens only when the text
  actually **changed**, so the portal echoing an unchanged value never clears a
  department set in the app.
- `domain_id: ""` / `null` on edit clears it. A blank `manager_id` is still
  ignored (leave approval needs an owner), as before.

New error messages: `Department not found` (400), `You can only assign
departments you are linked to` (403), `A user cannot report to themselves`
(400), `This reporting manager would create a loop in the reporting line` (400);
on `POST /domain`: `Parent department not found`, `A department cannot be its
own parent`, `This parent would create a loop in the department tree`,
`Department head not found`, `The department head must belong to the
department`, `sort_order must be a whole number` (all 400).

---

## Open questions from the requirements doc — what was assumed

| Question | Built as |
|---|---|
| Separate CEO role? | No. SP is the CEO; nothing role-related changed. |
| Two departments for a non-shared user? | No. One primary `domain_id`, plus the shared flag for many. |
| `isOnline` rule? | `lastSeenAt IS NULL` — the existing login/logout bookkeeping. A user who closes the app without logging out stays "online" until their next logout. |
| Efficiency formula? | `completed / total`, as `team-performance` already computes. |
