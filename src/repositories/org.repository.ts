import { Op, QueryTypes } from "sequelize";
import { Database } from "../connection/db/dbConnection";
import { User } from "../connection/models/user";
import { Domain } from "../connection/models/domain";

// The org view's reads. Every count here is a grouped SQL query keyed by
// person (dl.assigned_to); the service folds people into departments. A task's
// assignee lives on its daily log, never on the task, so every task count
// joins through daily_task_logs exactly as the report queries do.

const TASKS = `"tracker".tasks`;
const DAILY_LOGS = `"tracker".daily_task_logs`;
const STATUS_SLUG = `lower(replace(replace(t.status, ' ', '_'), '-', '_'))`;

// The window predicate. NULL bounds mean "no window" — the existing
// company-wide tiles read all time when no from/to is sent, and keep doing so.
const IN_WINDOW = `(CAST(:from AS date) IS NULL OR dl.date BETWEEN CAST(:from AS date) AND CAST(:to AS date))`;

// "Past due_date and not completed". :today is the server's local date, the
// same day the daily logs are written under (see todayDateOnly).
const IS_OVERDUE = `(t.due_date IS NOT NULL AND t.due_date < CAST(:today AS date) AND ${STATUS_SLUG} <> 'completed')`;

export interface Window {
  from: string | null;
  to: string | null;
}

export interface PersonMeasures {
  user_id: string;
  total: number;
  yet_to_start: number;
  in_progress: number;
  completed: number;
  blocked: number;
  overdue: number;
  // Completed tasks that had a due date, and how many of those finished on or
  // before it. onTimeRate is on_time / completed_with_due.
  completed_with_due: number;
  on_time: number;
  total_seconds: number;
}

export interface Membership {
  user_id: string;
  domain_id: string;
}

export interface MemberUser {
  id: string;
  fullName: string | null;
  email: string | null;
  role: string;
  job_title: string | null;
  employee_id: string | null;
  manager_id: string | null;
  domain_id: string | null;
  is_shared: boolean;
  isBlocked: boolean;
  lastSeenAt: string | null;
  joining_date: string | null;
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const MEMBER_ATTRIBUTES = [
  "id",
  "fullName",
  "email",
  "role",
  "job_title",
  "employee_id",
  "manager_id",
  "domain_id",
  "is_shared",
  "isBlocked",
  "lastSeenAt",
  "joining_date",
];

export class OrgRepository {
  private get sequelize() {
    return Database.getSequelize();
  }

  // Who belongs to which department:
  //   - everyone whose primary department is it (users.domain_id), and
  //   - every SHARED user linked to it through domain_assignments, who appears
  //     under every department they are linked to.
  // A non-shared user's domain_assignments rows are how an AM is linked to the
  // departments they run; they do not make that AM a member of each one.
  // SP is the company itself and sits above the tree, never inside it.
  public async memberships(): Promise<Membership[]> {
    try {
      const rows: any[] = await this.sequelize.query(
        `SELECT u.id AS user_id, u.domain_id
           FROM "tracker".users u
          WHERE u.domain_id IS NOT NULL
            AND u.role <> 'SP'
         UNION
         SELECT da.user_id, da.domain_id
           FROM "tracker".domain_assignments da
           JOIN "tracker".users u ON u.id = da.user_id
          WHERE u.is_shared = true
            AND u.role <> 'SP'`,
        { type: QueryTypes.SELECT }
      );
      return rows.map((row) => ({
        user_id: String(row.user_id),
        domain_id: String(row.domain_id),
      }));
    } catch (error) {
      throw error;
    }
  }

  public async findUsers(ids: string[]): Promise<MemberUser[]> {
    try {
      if (!ids.length) return [];
      const rows: any[] = await User.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: MEMBER_ATTRIBUTES,
        raw: true,
      });
      return rows as MemberUser[];
    } catch (error) {
      throw error;
    }
  }

  public async findUser(id: string): Promise<MemberUser | null> {
    try {
      const row: any = await User.findByPk(id, {
        attributes: MEMBER_ATTRIBUTES,
        raw: true,
      });
      return (row as MemberUser) ?? null;
    } catch (error) {
      throw error;
    }
  }

  // Every non-SP user, for the company tile.
  public async countEmployees(): Promise<number> {
    try {
      return await User.count({ where: { role: { [Op.ne]: "SP" } } });
    } catch (error) {
      throw error;
    }
  }

  public async allDomains(): Promise<any[]> {
    try {
      return await Domain.findAll({
        attributes: [
          "id",
          "name",
          "description",
          "parent_id",
          "head_user_id",
          "sort_order",
          "created_at",
        ],
        order: [
          ["sort_order", "ASC"],
          ["name", "ASC"],
        ],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }

  // One row per person with any task in the window. `userIds` null means
  // everyone, which is what the company totals ask for.
  public async personMeasures(input: {
    window: Window;
    userIds: string[] | null;
    today: string;
    projectId?: string | null;
  }): Promise<PersonMeasures[]> {
    try {
      if (input.userIds && !input.userIds.length) return [];
      const rows: any[] = await this.sequelize.query(
        `SELECT dl.assigned_to AS user_id,
                COUNT(t.id)::int AS total,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'yet_to_start')::int AS yet_to_start,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'in_progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'blocked')::int AS blocked,
                COUNT(*) FILTER (WHERE ${IS_OVERDUE})::int AS overdue,
                COUNT(*) FILTER (
                  WHERE ${STATUS_SLUG} = 'completed' AND t.due_date IS NOT NULL
                )::int AS completed_with_due,
                -- end_time is the finish moment of a completed task; a
                -- completed task with no end_time is given the benefit of the
                -- doubt rather than counted late.
                COUNT(*) FILTER (
                  WHERE ${STATUS_SLUG} = 'completed' AND t.due_date IS NOT NULL
                    AND (t.end_time IS NULL OR CAST(t.end_time AS date) <= t.due_date)
                )::int AS on_time,
                COALESCE(SUM(t.total_seconds), 0)::bigint AS total_seconds
           FROM ${TASKS} t
           JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
          WHERE ${IN_WINDOW}
            AND (:allUsers OR dl.assigned_to IN (:userIds))
            AND (CAST(:projectId AS varchar) IS NULL OR t.project_id = :projectId)
          GROUP BY dl.assigned_to`,
        {
          replacements: {
            from: input.window.from,
            to: input.window.to,
            today: input.today,
            allUsers: input.userIds === null,
            // IN () is a syntax error; a placeholder that matches nobody keeps
            // the query valid when allUsers short-circuits it anyway.
            userIds: input.userIds?.length ? input.userIds : [""],
            projectId: input.projectId ?? null,
          },
          type: QueryTypes.SELECT,
        }
      );
      return rows.map((row) => ({
        user_id: String(row.user_id),
        total: num(row.total),
        yet_to_start: num(row.yet_to_start),
        in_progress: num(row.in_progress),
        completed: num(row.completed),
        blocked: num(row.blocked),
        overdue: num(row.overdue),
        completed_with_due: num(row.completed_with_due),
        on_time: num(row.on_time),
        total_seconds: num(row.total_seconds),
      }));
    } catch (error) {
      throw error;
    }
  }

  // Tasks by priority for a set of people inside the window.
  public async priorityCounts(input: {
    window: Window;
    userIds: string[];
  }): Promise<Record<string, number>> {
    try {
      const out: Record<string, number> = { High: 0, Medium: 0, Low: 0 };
      if (!input.userIds.length) return out;
      const rows: any[] = await this.sequelize.query(
        `SELECT t.priority, COUNT(*)::int AS n
           FROM ${TASKS} t
           JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
          WHERE ${IN_WINDOW}
            AND dl.assigned_to IN (:userIds)
            AND t.priority IS NOT NULL
          GROUP BY t.priority`,
        {
          replacements: {
            from: input.window.from,
            to: input.window.to,
            userIds: input.userIds,
          },
          type: QueryTypes.SELECT,
        }
      );
      rows.forEach((row) => {
        out[String(row.priority)] = num(row.n);
      });
      return out;
    } catch (error) {
      throw error;
    }
  }

  // Tasks created per day and tasks completed per day, for the department's
  // people. Created is read off the task's own created_at and completed off
  // end_time, both as dates — a task logged on Monday and finished on Wednesday
  // counts on each of those days, which is what a created-vs-completed chart
  // is for.
  public async createdCompletedByDay(input: {
    from: string;
    to: string;
    userIds: string[];
  }): Promise<Array<{ date: string; created: number; completed: number }>> {
    try {
      if (!input.userIds.length) return [];
      const rows: any[] = await this.sequelize.query(
        `WITH scoped AS (
           SELECT t.created_at, t.end_time, ${STATUS_SLUG} AS slug
             FROM ${TASKS} t
             JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
            WHERE dl.assigned_to IN (:userIds)
         )
         SELECT day, SUM(created)::int AS created, SUM(completed)::int AS completed
           FROM (
             SELECT to_char(CAST(created_at AS date), 'YYYY-MM-DD') AS day,
                    1 AS created, 0 AS completed
               FROM scoped
              WHERE CAST(created_at AS date) BETWEEN CAST(:from AS date) AND CAST(:to AS date)
             UNION ALL
             SELECT to_char(CAST(end_time AS date), 'YYYY-MM-DD') AS day,
                    0 AS created, 1 AS completed
               FROM scoped
              WHERE slug = 'completed'
                AND end_time IS NOT NULL
                AND CAST(end_time AS date) BETWEEN CAST(:from AS date) AND CAST(:to AS date)
           ) per_day
          GROUP BY day`,
        {
          replacements: { from: input.from, to: input.to, userIds: input.userIds },
          type: QueryTypes.SELECT,
        }
      );
      return rows.map((row) => ({
        date: String(row.day),
        created: num(row.created),
        completed: num(row.completed),
      }));
    } catch (error) {
      throw error;
    }
  }

  // The task each person has a live timer on, if any. Same "session open"
  // rule as the board: started, and not stopped since.
  public async runningTasks(
    userIds: string[]
  ): Promise<Map<string, { id: string; description: string | null; startedAt: string | null }>> {
    try {
      const out = new Map<string, { id: string; description: string | null; startedAt: string | null }>();
      if (!userIds.length) return out;
      const rows: any[] = await this.sequelize.query(
        `SELECT DISTINCT ON (dl.assigned_to)
                dl.assigned_to AS user_id,
                t.id,
                t.description,
                to_char(t.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
           FROM ${TASKS} t
           JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
          WHERE dl.assigned_to IN (:userIds)
            AND ${STATUS_SLUG} = 'in_progress'
            AND t.start_time IS NOT NULL
            AND (t.end_time IS NULL OR t.end_time < t.start_time)
          ORDER BY dl.assigned_to, t.start_time DESC`,
        { replacements: { userIds }, type: QueryTypes.SELECT }
      );
      rows.forEach((row) => {
        out.set(String(row.user_id), {
          id: String(row.id),
          description: row.description ?? null,
          startedAt: row.started_at ?? null,
        });
      });
      return out;
    } catch (error) {
      throw error;
    }
  }

  // Active projects per department, for the tree cards and list-domains.
  public async activeProjectCounts(): Promise<Map<string, number>> {
    try {
      const rows: any[] = await this.sequelize.query(
        `SELECT domain_id, COUNT(*)::int AS n
           FROM "tracker".projects
          WHERE status = 'active' AND domain_id IS NOT NULL
          GROUP BY domain_id`,
        { type: QueryTypes.SELECT }
      );
      return new Map(rows.map((row) => [String(row.domain_id), num(row.n)]));
    } catch (error) {
      throw error;
    }
  }

  // A department's projects with member counts and the latest due date.
  public async domainProjects(domainId: string): Promise<any[]> {
    try {
      const rows: any[] = await this.sequelize.query(
        `SELECT p.id, p.name, p.status, COALESCE(p.progress, 0) AS progress,
                to_char(p.end_date, 'YYYY-MM-DD') AS due_date,
                (SELECT COUNT(DISTINCT pm.user_id)
                   FROM "tracker".project_members pm
                  WHERE pm.project_id = p.id)::int AS members
           FROM "tracker".projects p
          WHERE p.domain_id = :domainId
          ORDER BY (p.status = 'active') DESC, p.end_date ASC NULLS LAST, p.name ASC`,
        { replacements: { domainId }, type: QueryTypes.SELECT }
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        status: row.status,
        progress: num(row.progress),
        dueDate: row.due_date ?? null,
        members: num(row.members),
      }));
    } catch (error) {
      throw error;
    }
  }

  // Deadline pushes recorded on a person's tasks inside the window.
  public async extensionCount(input: {
    userId: string;
    window: Window;
  }): Promise<number> {
    try {
      const rows: any[] = await this.sequelize.query(
        `SELECT COUNT(e.id)::int AS n
           FROM "tracker".task_extensions e
           JOIN ${TASKS} t ON t.id = e.task_id
           JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
          WHERE dl.assigned_to = :userId
            AND ${IN_WINDOW}`,
        {
          replacements: {
            userId: input.userId,
            from: input.window.from,
            to: input.window.to,
          },
          type: QueryTypes.SELECT,
        }
      );
      return num(rows[0]?.n);
    } catch (error) {
      throw error;
    }
  }

  // A person's current projects: their project memberships, each with the
  // number of their tasks on it still open inside the window.
  public async userProjects(input: {
    userId: string;
    window: Window;
  }): Promise<Array<{ id: string; name: string; tasksOpen: number }>> {
    try {
      const rows: any[] = await this.sequelize.query(
        `SELECT p.id, p.name,
                (SELECT COUNT(*)
                   FROM ${TASKS} t
                   JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
                  WHERE t.project_id = p.id
                    AND dl.assigned_to = :userId
                    AND ${STATUS_SLUG} <> 'completed'
                    AND ${IN_WINDOW})::int AS tasks_open
           FROM "tracker".project_members pm
           JOIN "tracker".projects p ON p.id = pm.project_id
          WHERE pm.user_id = :userId
          ORDER BY p.name ASC`,
        {
          replacements: {
            userId: input.userId,
            from: input.window.from,
            to: input.window.to,
          },
          type: QueryTypes.SELECT,
        }
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        tasksOpen: num(row.tasks_open),
      }));
    } catch (error) {
      throw error;
    }
  }

  // Status counts for GET /department-tasks — over the WHOLE filtered set, not
  // the current page, and before the status filter is applied, so the tabs
  // above the table keep their counts when one of them is selected.
  public async taskStatusMeta(input: {
    window: Window;
    userIds: string[];
    today: string;
    priority?: string | null;
    projectId?: string | null;
    overdueOnly?: boolean;
  }): Promise<Record<string, number>> {
    try {
      const out: Record<string, number> = {
        total: 0,
        yetToStart: 0,
        inProgress: 0,
        completed: 0,
        blocked: 0,
        overdue: 0,
      };
      if (!input.userIds.length) return out;
      const rows: any[] = await this.sequelize.query(
        `SELECT COUNT(t.id)::int AS total,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'yet_to_start')::int AS yet_to_start,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'in_progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'blocked')::int AS blocked,
                COUNT(*) FILTER (WHERE ${IS_OVERDUE})::int AS overdue
           FROM ${TASKS} t
           JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id
          WHERE t.parent_id IS NULL
            AND ${IN_WINDOW}
            AND dl.assigned_to IN (:userIds)
            AND (CAST(:priority AS varchar) IS NULL OR CAST(t.priority AS varchar) = :priority)
            AND (CAST(:projectId AS varchar) IS NULL OR t.project_id = :projectId)
            AND (NOT :overdueOnly OR ${IS_OVERDUE})`,
        {
          replacements: {
            from: input.window.from,
            to: input.window.to,
            today: input.today,
            userIds: input.userIds,
            priority: input.priority ?? null,
            projectId: input.projectId ?? null,
            overdueOnly: !!input.overdueOnly,
          },
          type: QueryTypes.SELECT,
        }
      );
      const row = rows[0] ?? {};
      out.total = num(row.total);
      out.yetToStart = num(row.yet_to_start);
      out.inProgress = num(row.in_progress);
      out.completed = num(row.completed);
      out.blocked = num(row.blocked);
      out.overdue = num(row.overdue);
      return out;
    } catch (error) {
      throw error;
    }
  }
}
