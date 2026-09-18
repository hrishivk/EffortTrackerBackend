import { Op, QueryTypes } from "sequelize";
import { Database } from "../connection/db/dbConnection";
import { User } from "../connection/models/user";
import { DomainAssignment } from "../connection/models/domain_assignment";


const TASKS = `"tracker".tasks`;
const DAILY_LOGS = `"tracker".daily_task_logs`;


const STATUS_SLUG = `lower(replace(replace(t.status, ' ', '_'), '-', '_'))`;


const SCOPED_FROM = `
    FROM ${TASKS} t
    JOIN ${DAILY_LOGS} dl ON dl.id = t.daily_log_id`;


const SCOPED_WHERE = `
   WHERE dl.date BETWEEN CAST(:from AS date) AND CAST(:to AS date)
     AND dl.assigned_to IN (:userIds)
     AND (:projectId IS NULL OR t.project_id = :projectId)
     -- The status-group filter, matched on the NORMALISED name rather than on
     -- tasks.group_id or on the literal name. Both of the obvious alternatives
     -- are wrong, measured on the live data for the Yet to Start lane:
     --
     --   t.group_id = <lane id>        ->  14 of 338 tasks. group_id is only
     --                                     set when a card is moved onto the
     --                                     lane; 325 carry the status with a
     --                                     NULL group_id and would vanish.
     --   t.status = <lane name>        ->  0 tasks. statusForGroup() canonicalises
     --                                     a lane whose name spells a real status,
     --                                     so "Yet to Start" is STORED as
     --                                     yet_to_start and the literal never appears.
     --   slug(t.status) = slug(name)   ->  338. Correct.
     --
     -- Both sides are slugged by the SAME expression, in SQL, so the two can
     -- never drift the way a JS-side slug and a SQL-side slug would.
     AND (:groupName IS NULL
          OR ${STATUS_SLUG} = lower(replace(replace(:groupName, ' ', '_'), '-', '_')))`;

const SCOPED_ROWS = `${SCOPED_FROM}${SCOPED_WHERE}`;


const SUBTASK_ROLLUP = `
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS n,
                    MIN(c.start_time) AS min_start,
                    MAX(c.end_time)   AS max_end,
                    COUNT(*) FILTER (
                      WHERE c.start_time IS NOT NULL
                        AND (c.end_time IS NULL OR c.end_time < c.start_time)
                    )::int AS running
               FROM ${TASKS} c
              WHERE c.parent_id = t.id
           ) kids ON TRUE`;

const EFFECTIVE_START = `(CASE WHEN kids.n > 0 THEN kids.min_start ELSE t.start_time END)`;


const EFFECTIVE_END = `(CASE
                          WHEN kids.n > 0
                            THEN CASE WHEN kids.running > 0 THEN NULL ELSE kids.max_end END
                          WHEN t.start_time IS NOT NULL
                           AND (t.end_time IS NULL OR t.end_time < t.start_time)
                            THEN NULL
                          ELSE t.end_time
                        END)`;


const MEASURES = `
       COUNT(t.id)::int AS tasks_worked,
       COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE ${STATUS_SLUG} = 'in_progress')::int AS in_progress,
       COALESCE(SUM(t.total_seconds), 0)::bigint AS total_seconds`;

export interface ReportFilters {
  userIds: string[];
  from: string;
  to: string;
  project_id?: string | null;
  // The status group's NAME, not its id — see the filter comment above.
  group_name?: string | null;
}

export interface Measures {
  tasks_worked: number;
  completed: number;
  in_progress: number;
  total_seconds: number;
}

export interface DailyBucket extends Measures {
  date: string;
}

export interface MemberBucket extends Measures {
  user_id: string;
}


export interface TaskRow {
  id: string;
  description: string | null;
  project: string | null;
  status: string;
  start_date: string | null;

  start_time: string | null;
  end_time: string | null;
  completed_at: string | null;
  due_date: string | null;
}


export const TASK_ROWS_LIMIT = 5000;

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toMeasures = (row: any): Measures => ({
  tasks_worked: num(row.tasks_worked),
  completed: num(row.completed),
  in_progress: num(row.in_progress),
  total_seconds: num(row.total_seconds),
});

export class ReportRepository {

  public async dailyTotals(filters: ReportFilters): Promise<DailyBucket[]> {
    try {
      if (!filters.userIds.length) return [];

      const sequelize = Database.getSequelize();
      const rows: any[] = await sequelize.query(
        `SELECT to_char(dl.date, 'YYYY-MM-DD') AS date,
          ${MEASURES}
          ${SCOPED_ROWS}
           GROUP BY dl.date
           ORDER BY dl.date ASC`,
        {
          replacements: {
            from: filters.from,
            to: filters.to,
            userIds: filters.userIds,
            projectId: filters.project_id ?? null,
            groupName: filters.group_name ?? null,
          },
          type: QueryTypes.SELECT,
        }
      );

      return rows.map((row) => ({ date: String(row.date), ...toMeasures(row) }));
    } catch (error) {
      console.error("Error in dailyTotals:", error);
      throw error;
    }
  }


  public async memberTotals(filters: ReportFilters): Promise<MemberBucket[]> {
    try {
      if (!filters.userIds.length) return [];

      const sequelize = Database.getSequelize();
      const rows: any[] = await sequelize.query(
        `SELECT dl.assigned_to AS user_id,
          ${MEASURES}
          ${SCOPED_ROWS}
           GROUP BY dl.assigned_to`,
        {
          replacements: {
            from: filters.from,
            to: filters.to,
            userIds: filters.userIds,
            projectId: filters.project_id ?? null,
            groupName: filters.group_name ?? null,
          },
          type: QueryTypes.SELECT,
        }
      );

      return rows.map((row) => ({
        user_id: String(row.user_id),
        ...toMeasures(row),
      }));
    } catch (error) {
      console.error("Error in memberTotals:", error);
      throw error;
    }
  }


  public async taskRows(
    filters: ReportFilters,
    limit: number = TASK_ROWS_LIMIT
  ): Promise<TaskRow[]> {
    try {
      if (!filters.userIds.length) return [];

      const sequelize = Database.getSequelize();
      const rows: any[] = await sequelize.query(
        `SELECT t.id,
                t.description,
                p.name AS project,
                t.status,
                to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
                to_char(${EFFECTIVE_START} AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
                to_char(${EFFECTIVE_END} AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
                CASE WHEN ${STATUS_SLUG} = 'completed'
                     THEN to_char(dl.date, 'YYYY-MM-DD') END AS completed_at,
                to_char(t.due_date, 'YYYY-MM-DD') AS due_date
           ${SCOPED_FROM}
           LEFT JOIN "tracker".projects p ON p.id = t.project_id
           ${SUBTASK_ROLLUP}
           ${SCOPED_WHERE}
           ORDER BY dl.date ASC, t.created_at ASC
           LIMIT ${Number(limit) + 1}`,
        {
          replacements: {
            from: filters.from,
            to: filters.to,
            userIds: filters.userIds,
            projectId: filters.project_id ?? null,
            groupName: filters.group_name ?? null,
          },
          type: QueryTypes.SELECT,
        }
      );


      return rows.map((row) => ({
        id: String(row.id),
        description: row.description ?? null,
        project: row.project ?? null,
        status: String(row.status ?? ""),
        start_date: row.start_date ?? null,
        start_time: row.start_time ?? null,
        end_time: row.end_time ?? null,
        completed_at: row.completed_at ?? null,
        due_date: row.due_date ?? null,
      }));
    } catch (error) {
      console.error("Error in taskRows:", error);
      throw error;
    }
  }
}


const ACTIVE_MEMBER_ROLES = ["AM", "MG", "USER", "DEVLOPER"];

export interface MemberRow {
  id: string;
  fullName: string | null;
}

export class ReportDirectoryRepository {
  public async findUser(id: string): Promise<any | null> {
    try {
      return await User.findOne({
        where: { id },
        attributes: ["id", "fullName", "manager_id", "is_shared", "role", "isBlocked"],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }


  public async userIdsInDepartment(department_id: string): Promise<string[]> {
    try {
      const rows: any[] = await DomainAssignment.findAll({
        where: { domain_id: department_id },
        attributes: ["user_id"],
        raw: true,
      });
      return [...new Set(rows.map((row) => String(row.user_id)))];
    } catch (error) {
      throw error;
    }
  }


  public async membersByIds(ids: string[]): Promise<MemberRow[]> {
    try {
      if (!ids.length) return [];
      const rows: any[] = await User.findAll({
        where: { id: { [Op.in]: ids }, isBlocked: false },
        attributes: ["id", "fullName"],
        order: [["fullName", "ASC"]],
        raw: true,
      });
      return rows.map((row) => ({
        id: String(row.id),
        fullName: row.fullName ?? null,
      }));
    } catch (error) {
      throw error;
    }
  }


  public async managedBy(
    manager_id: string,
    domainPeerIds: string[]
  ): Promise<MemberRow[]> {
    try {
      const rows: any[] = await User.findAll({
        where: {
          isBlocked: false,
          role: { [Op.in]: ACTIVE_MEMBER_ROLES },
          [Op.or]: [
            { manager_id },
            ...(domainPeerIds.length
              ? [{ is_shared: true, id: { [Op.in]: domainPeerIds } }]
              : []),
          ],
        },
        attributes: ["id", "fullName"],
        order: [["fullName", "ASC"]],
        raw: true,
      });
      return rows.map((row) => ({
        id: String(row.id),
        fullName: row.fullName ?? null,
      }));
    } catch (error) {
      throw error;
    }
  }

 
  public async allMembers(): Promise<MemberRow[]> {
    try {
      const rows: any[] = await User.findAll({
        where: { isBlocked: false, role: { [Op.in]: ACTIVE_MEMBER_ROLES } },
        attributes: ["id", "fullName"],
        order: [["fullName", "ASC"]],
        raw: true,
      });
      return rows.map((row) => ({
        id: String(row.id),
        fullName: row.fullName ?? null,
      }));
    } catch (error) {
      throw error;
    }
  }
}
