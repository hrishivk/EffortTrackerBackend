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

// ── Timer columns for the export ─────────────────────────────────────────────
//
// start_time / end_time are the ACTUAL work (stamped on status transitions),
// as opposed to start_date / due_date which are the plan. Since nothing in the
// app writes the plan, these are the only real dates the sheet can show.
//
// The subtask roll-up, matching the List View's taskTiming(): a task WITH
// subtasks starts when its first subtask starts and ends when its last one
// finishes. Only direct children — a subtask is one level deep. A task with no
// children keeps its own clock, and a subtask row uses its own.
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

// "null while it is still running", which is NOT the same as "end_time IS NULL".
// A task that was stopped and then resumed keeps its OLD end_time, so the row
// still carries a timestamp that is now EARLIER than start_time — the
// isSessionOpen rule in user.repository. Reporting that stale value would show
// a task ending before it began. One row in the live data is in that state.
//
// A parent is running while ANY of its children is: it cannot have finished
// before its last subtask did.
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

// One row of the export sheet. Every date is 'YYYY-MM-DD' or null; `status`
// leaves here RAW (the stored slug or a custom lane name) and is turned into a
// display label in the service.
export interface TaskRow {
  id: string;
  description: string | null;
  project: string | null;
  status: string;
  start_date: string | null;
  // Full ISO-8601 UTC ("2026-09-09T15:15:00Z"). Formatted in Postgres, not by
  // serialising a JS Date, for the same reason the date-only fields are: a
  // Date coming back through the driver gets re-rendered in the server's
  // offset and the hour shifts.
  start_time: string | null;
  end_time: string | null;
  completed_at: string | null;
  due_date: string | null;
}

// The row cap. A per-user window is far smaller than this in practice — the
// whole tasks table is 773 rows today — so truncation should never fire; it is
// here so a pathological range cannot pull an unbounded result into memory.
// The service reports `tasks_truncated` when it does fire, rather than
// silently shipping a short sheet.
export const TASK_ROWS_LIMIT = 5000;

// pg returns bigint as a string (it does not fit a JS number in the general
// case) and COUNT(...)::int as a number. Everything crossing into the response
// goes through here so the API never emits "152280" where it documents 152280.
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
  // One row per day that has any work in it. Days with nothing are NOT
  // returned — the service zero-fills them, because a gap in this array is a
  // real fact about the window and the chart has to draw it as zero rather
  // than as a straight line from Friday to Monday.
  public async dailyTotals(filters: ReportFilters): Promise<DailyBucket[]> {
    try {
      // `IN ()` is not valid SQL, and an empty scope has no work in it by
      // definition — an AM whose team is empty, or a department filter that
      // matched nobody.
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

      // to_char, not date::text: a DATEONLY column comes back from pg as a
      // JS Date through some driver paths, and .toISOString() on it would
      // shift the day by the server's offset — the whole bug this range work
      // exists to remove. Formatting in Postgres leaves no Date to mishandle.
      return rows.map((row) => ({ date: String(row.date), ...toMeasures(row) }));
    } catch (error) {
      console.error("Error in dailyTotals:", error);
      throw error;
    }
  }

  // One row per member who has any work in the window. Members with none are
  // absent here and zero-filled by the service: "nobody logged anything this
  // week" is the most useful thing a team report can say, and dropping the row
  // hides it.
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

  // The individual rows behind the totals — the export sheet.
  //
  // Same SCOPED_WHERE as dailyTotals and memberTotals, so `tasks.length` equals
  // `totals.tasks_worked` exactly unless the cap fired. That is not a
  // coincidence to be maintained by hand; it is the same string.
  //
  // `completed_at` is DERIVED, because tasks has no completion column. For a
  // completed row it is that row's daily-log date, which is the day it was
  // completed: carry-over only moves unfinished work (in_progress /
  // yet_to_start), so a completed row stays in the log of the day it was
  // finished and is never copied forward again. NULL for anything not
  // completed, which is the honest answer for work still in flight.
  //
  // t.end_time was the other candidate and is worse: it records when the TIMER
  // last stopped, so a task paused on Monday and marked done on Wednesday
  // carries Monday. The two disagree on 27% of the completed rows in the live
  // data, and on those the log date is the correct one.
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

      // LIMIT is asked for one more than the cap purely so the service can tell
      // "exactly at the cap" from "there was more", without a second COUNT.
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

// ── The reportable population ────────────────────────────────────────────────
//
// Who a report MAY cover is §3's business, decided in report.service. What
// lives here is only how to fetch a set of users once that decision is made.

// Blocked accounts are excluded everywhere below. A blocked person cannot log
// work, so their row would be a permanent zero that makes every team average
// look worse than it is — and "include members with nothing in the window"
// exists to surface someone who went quiet, not someone who was switched off.
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

  // The user ids linked to one department (a `domains` row — the app calls the
  // same thing a domain in the schema and a department in the UI).
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

  // `ids` is the already-authorised set from §3. Ordered by name so the
  // zero-work members the service appends land in a stable place and the
  // members page does not reshuffle between requests.
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

  // Everyone an AM manages: their own team plus shared users assigned to one
  // of their domains — deliberately the same set adminManagerRepository
  // .listAllusers and /role-sp/list-users return them, so every person an AM
  // can see in the member picker is a person whose report they can open, and
  // nobody else is.
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

  // Every reportable account, for SP. SP itself is excluded by
  // ACTIVE_MEMBER_ROLES: a super admin is not a member of anybody's team, and
  // a row of zeroes for the platform owner is noise in every team average.
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
