import { User } from "../connection/models/user";
import bcrypt from "bcrypt";
import { credentialHashing } from "../credential/hash";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { AddTask } from "../types/user.types";
import { Task } from "../connection/models/tasks";
import { TaskStatus } from "../types/task.types";
import { Model, Op, Sequelize } from "sequelize";
import { Project } from "../connection/models/project";
import { Domain } from "../connection/models/domain";
import { ProjectMember } from "../connection/models/project_member";
import { TaskGroup } from "../connection/models/task_group";
import { Transaction } from "sequelize";
import { DateRange } from "../utils/dateRange";

const CredentialHashing = new credentialHashing();

const VALID_TASK_STATUSES: TaskStatus[] = [
  "yet_to_start",
  "in_progress",
  "completed",
  "blocked",
];

// in_progress first, then yet_to_start, so a task that was started shows on top
const TASK_STATUS_ORDER = Sequelize.literal(
  `CASE "Task"."status"
     WHEN 'in_progress' THEN 1
     WHEN 'yet_to_start' THEN 2
     WHEN 'blocked' THEN 3
     WHEN 'completed' THEN 4
     ELSE 5
   END`
);

// Since 009 status is free text and may hold a group name, so the ?status=
// filter can no longer whitelist the four enum values — doing so made an
// unknown value return EVERY task instead of none. Compare slugified on both
// sides so "Production", "production" and "Yet to Start" all match what is
// stored ("Production", "yet_to_start").
const STATUS_SLUG = Sequelize.fn(
  "lower",
  Sequelize.fn(
    "replace",
    Sequelize.fn("replace", Sequelize.col("Task.status"), " ", "_"),
    "-",
    "_"
  )
);

const slugifyStatus = (value: string): string =>
  String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");

export const parseStatusFilter = (
  status?: string | string[]
): string[] | undefined => {
  if (!status) return undefined;
  const raw = Array.isArray(status) ? status : String(status).split(",");
  const cleaned = raw.map(slugifyStatus).filter((v) => v.length > 0);
  return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
};

// A single working session is capped. When a task is left in in_progress
// overnight nobody knows when the person actually stopped, and without a cap the
// frontend counts now - start_time forever — one task had reached 858 hours.
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

// Accepts the array the client sends, or a comma-separated string, and returns
// clean labels: trimmed, blanks dropped, de-duplicated case-insensitively
// (first spelling wins), each capped in length and the list capped in count.
export const normalizeTags = (input?: unknown): string[] => {
  if (input === undefined || input === null) return [];
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
    ? input.split(",")
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const tag = String(item).trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
};

// The `date` predicate for a daily-log query, built from either a single day
// or an inclusive {from, to} window (§0).
//
// A single day stays an equality test so the existing index use does not
// change, and keeps the split("T") callers have always relied on to pass a
// full ISO string. A range becomes an inclusive BETWEEN over two date-only
// strings — daily_task_logs.date is DATEONLY, so comparing it against
// YYYY-MM-DD carries no timezone and the window cannot drift by a day.
//
// undefined means NO date predicate: every log, whenever it was written. That
// is what the board gets when it sends neither a date nor a range, which is
// exactly what it does today.
const dailyLogDateWhere = (window?: string | DateRange): any => {
  if (window === undefined || window === null) return undefined;
  if (typeof window === "string") {
    const trimmed = window.trim();
    return trimmed ? trimmed.split("T")[0] : undefined;
  }
  return { [Op.between]: [window.from, window.to] };
};

export const MAX_SESSION_SECONDS = 8 * 60 * 60;

// The four real statuses, as opposed to a group name sitting in status since
// 009. Mirrors the set in user.service; kept here too so the parent roll-up
// does not have to reach up into the service layer.
const REAL_STATUS_SET = new Set([
  "yet_to_start",
  "in_progress",
  "completed",
  "blocked",
]);

// Only the three ordered states. `blocked` is deliberately absent: it is a real
// status but not a step on the path, so the roll-up neither moves a parent to
// it nor treats it as progress.
const STATUS_RANK_ORDER: Record<string, number> = {
  yet_to_start: 0,
  in_progress: 1,
  completed: 2,
};

// A session is running if the clock is set and no stop came AFTER it. Checking
// only "end_time is null" is wrong: a task that was stopped and then resumed
// keeps the older end_time, so start_time > end_time also means running.
export const isSessionOpen = (
  start_time?: Date | null,
  end_time?: Date | null
): boolean => {
  if (!start_time) return false;
  if (!end_time) return true;
  return new Date(end_time).getTime() < new Date(start_time).getTime();
};

// "3h 30m", "45m", "0m" — the display twin of total_seconds.
export const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// The value tasks.status carries for a task parked in this group: a group whose
// name spells a real status canonicalises to it ("Completed" -> "completed"),
// anything else is stored verbatim ("Production").
export const statusForGroup = (name?: string): string | undefined => {
  if (!name) return undefined;
  const [match] = normalizeTaskStatus(slugifyStatus(name)) ?? [];
  return match ?? name.trim();
};

// Strict: still only the four real states. Used to validate a client-sent
// status and to canonicalise a group name that spells one.
export const normalizeTaskStatus = (
  status?: string | string[]
): TaskStatus[] | undefined => {
  if (!status) return undefined;
  const raw = Array.isArray(status) ? status : String(status).split(",");
  const cleaned = raw
    .map((value) => String(value).trim().toLowerCase())
    .filter((value): value is TaskStatus =>
      VALID_TASK_STATUSES.includes(value as TaskStatus)
    );
  return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
};
// The nested children of a board card, and the shape §3 of the room
// shared-tasks contract asks for. Extracted because three reads embed it
// (todayTask, tasksByProject and findTaskWithSubtasks) and they drifted apart
// once already.
//
// dailyLog -> assignedUser is how a subtask carries WHOSE subtask it is:
// assignment is not a column on tasks, it lives on the child's own daily log,
// which is what lets one parent's children sit in three different people's
// logs. taskView.decorateTask lifts it to a flat `assigned_to` /
// `assignedUser` pair on the subtask so the row renders without the client
// walking into dailyLog.
//
// separate: true — a hasMany with its own ORDER BY cannot be ordered inside a
// LIMITed parent query, and the parent query is paginated.
// Returns `any` because Sequelize's Includeable type cannot express an ORDER
// on a `separate` hasMany without every tuple being widened by hand.
export const subtaskInclude = (): any => ({
  model: Task,
  as: "subtasks",
  required: false,
  separate: true,
  include: [
    {
      model: TaskGroup,
      as: "group",
      attributes: ["id", "name", "color", "position"],
    },
    {
      model: DailyTaskLog,
      as: "dailyLog",
      attributes: ["id", "created_by", "assigned_to"],
      include: [
        {
          model: User,
          as: "assignedUser",
          attributes: ["id", "fullName", "email"],
        },
      ],
    },
  ],
  // position first, created_at as the tie-break so children created before
  // 018 (all on position 0 until its backfill runs) keep the order the board
  // has always drawn them in.
  order: [
    ["position", "ASC"],
    ["created_at", "ASC"],
  ],
});

export class UserRepository {
  async findUserByEmail(email: string) {
    try {
      return await User.findOne({
        where: { email },
        include: [
          {
            model: Project,
            as: "projects",
            through: { attributes: ["role"] },
            include: [{ model: Domain, as: "domain" }],
          },
        ],
      });
    } catch (error) {
      console.error("Error finding user by email:", error);
      throw error;
    }
  }

  async verifyPassword(
    plainpassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      const isMatch = await bcrypt.compare(plainpassword, hashedPassword);
      return isMatch;
    } catch (error) {
      console.error("Error verifying password:", error);
      throw error;
    }
  }
  async findTask(id: string) {
    const data = await Task.findOne({
      where: { id },
      include: [
        {
          model: DailyTaskLog,
          as: "dailyLog",
          attributes: ["locked", "assigned_to"],
        },
      ],
    });
    return data;
  }
  // Returned by POST /task so the caller gets the parent and its subtasks in
  // one response.
  async findTaskWithSubtasks(id: string) {
    try {
      return await Task.findByPk(id, {
        include: [
          subtaskInclude(),
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
      });
    } catch (error) {
      throw error;
    }
  }

  // Bare row, no includes. Used where only the row's own columns matter -
  // `sequential` on a parent, `position` on a child.
  async findTaskRaw(id: string, transaction?: Transaction) {
    try {
      return await Task.findByPk(id, { transaction });
    } catch (error) {
      throw error;
    }
  }

  // The children of one parent, in the order the sequential rule reads them.
  // Takes the transaction so the §4 order check and the parent roll-up both
  // see the same snapshot as the child update they are wrapped around.
  async findChildren(parent_id: string, transaction?: Transaction) {
    try {
      return await Task.findAll({
        where: { parent_id },
        order: [
          ["position", "ASC"],
          ["created_at", "ASC"],
        ],
        include: [
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
        transaction,
      });
    } catch (error) {
      throw error;
    }
  }

  // §3, the rule that makes the feature visible: a caller gets a parent when
  // they are the assignee of ANY of its subtasks.
  //
  // Resolved through daily logs because that is where assignment lives — these
  // are the log ids the caller can see, so any CHILD sitting in one of them is
  // a child of theirs, and its parent_id is a parent they are entitled to.
  // Returns only parent ids; the caller unions them into its own where clause
  // so the parent still comes back whole, with ALL of its subtasks.
  async parentIdsForChildLogs(logIds: string[]): Promise<string[]> {
    try {
      if (!logIds.length) return [];
      const rows = await Task.findAll({
        where: {
          daily_log_id: { [Op.in]: logIds },
          parent_id: { [Op.ne]: null },
        },
        attributes: ["parent_id"],
        group: ["parent_id"],
        raw: true,
      });
      return rows
        .map((r: any) => r.parent_id)
        .filter((v: string | null): v is string => !!v);
    } catch (error) {
      throw error;
    }
  }

  // Names and emails for a set of user ids, in one query. Used to resolve
  // comment authors for a whole /task-list page at once rather than per
  // comment, and to turn an @-mention into a real user before a notification
  // is raised for it.
  async findUsersLite(ids: string[]) {
    try {
      const unique = [...new Set((ids ?? []).filter(Boolean))];
      if (!unique.length) return [];
      return await User.findAll({
        where: { id: { [Op.in]: unique } },
        attributes: ["id", "fullName", "email"],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }

  // Every daily log inside a window, whatever its owner. Used only to keep
  // the room-wide read rule inside the days the board is asking for: without
  // it, "readable by every member of the room" would drag a room's whole
  // history onto the board. Bounded by one row per person per day, so a range
  // costs (people x days) ids rather than the room's lifetime.
  //
  // An absent window returns nothing rather than everything, on purpose. The
  // room rule is the widest read in the app, and unbounded it is no rule at
  // all — the caller keeps its own daily logs either way.
  async logIdsForWindow(window?: string | DateRange): Promise<string[]> {
    try {
      const dateWhere = dailyLogDateWhere(window);
      if (dateWhere === undefined) return [];
      const rows = await DailyTaskLog.findAll({
        where: { date: dateWhere },
        attributes: ["id"],
        raw: true,
      });
      return rows.map((r: any) => r.id);
    } catch (error) {
      throw error;
    }
  }

  async findCheckTask(daily_log_id: string, date: Date, id: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await Task.findOne({
      where: {
        daily_log_id,
        created_at: {
          [Op.between]: [startOfDay, endOfDay],
        },
        status: "in_progress",
        id: {
          [Op.ne]: id,
        },
      },
    });
  }
  async securePassword(password: string) {
    try {
      const hashPassword = await CredentialHashing.hashPassword(password);
      return hashPassword;
    } catch (error) {
      console.error("Error hashing password:", error);
      throw error;
    }
  }

  public async secureToken(id: string, email: string, role: string) {
    try {
      const token = await CredentialHashing.hashtoken(id, email, role);
      const hashToken = token
        ? token
        : (() => {
            throw new Error("token not found");
          })();

      return hashToken;
    } catch (error) {
      console.error("Failed to secure token and set cookie:", error);
      throw error;
    }
  }

  public async createUser(userData: any) {
    try {

      console.log('userdataaaaa',userData)
      return await User.create(userData);
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  }
  public async setUserActive(userId: string) {
    try {
      return await User.update({ lastSeenAt: null }, { where: { id: userId } });
    } catch (error) {
      console.error("Error setting user active:", error);
      throw error;
    }
  }

  public async setUserLogout(userId: string) {
    try {
      return await User.update(
        { lastSeenAt: new Date().toISOString() },
        { where: { id: userId } }
      );
    } catch (error) {
      console.error("Error setting user logout:", error);
      throw error;
    }
  }
  public async findDailyTaskLog(dailytaskTime: string, created_by: string | undefined, assigned_to: string | undefined) {
    try {
      return await DailyTaskLog.findOne({
        where: {
          created_by: created_by,
          assigned_to: assigned_to,
          date: dailytaskTime,
        },
      });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createDailyTaskLog(created_by?: string, assigned_to?: string, dailytaskTime?: string, project_id?: string) {
    try {
      const data = await DailyTaskLog.create({
        created_by: created_by ?? assigned_to,
        assigned_to: assigned_to,
        date: dailytaskTime,
        project_id: project_id || null,
        total_time: "0",
      });
      return data;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createNewTask(data: AddTask): Promise<Task> {
    try {
      const { dailyTaskLog, project_id, description, priority, end_time, start_time, start_date, due_date, group_id, room_id, parent_id, tags, status, position, sequential } = data;
      const taskData: any = {
        daily_log_id: dailyTaskLog.id,
        project_id: project_id,
        description: description,
        priority: priority,
      };
      // The plan. due_date is where the form's "Due Date" belongs — putting it
      // in end_time meant completing the task erased the deadline.
      if (start_date) taskData.start_date = start_date;
      if (due_date) taskData.due_date = due_date;
      // Back-compat: callers still sending the deadline as end_time get it
      // mirrored into due_date so it survives completion.
      if (end_time) {
        taskData.end_time = new Date(end_time);
        if (!due_date) taskData.due_date = new Date(end_time);
      }
      // Set by addTask when a task is created straight into in_progress, so the
      // live timer has a clock to count from. Deliberately NOT set on the login
      // carry-over: that would accrue time from the moment of login, whether or
      // not the user actually resumed the work.
      if (start_time) taskData.start_time = new Date(start_time);
      if (group_id) taskData.group_id = group_id;
      if (room_id) taskData.room_id = room_id;
      if (parent_id) taskData.parent_id = parent_id;
      // Only meaningful on a child. Written unconditionally so a caller can
      // send 0 deliberately — `if (position)` would drop it.
      if (position !== undefined && position !== null) {
        taskData.position = position;
      }
      // Set on the PARENT. Coerced rather than passed through: this arrives
      // straight off req.body, so a form that sends the string "true" or a 1
      // must not reach a boolean column as text.
      const rawSequential: unknown = sequential;
      if (rawSequential !== undefined && rawSequential !== null) {
        taskData.sequential =
          rawSequential === true ||
          rawSequential === "true" ||
          rawSequential === 1;
      }
      taskData.tags = normalizeTags(tags);
      if (status) taskData.status = status;
      return await Task.create(taskData);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  // Stops the clock on every task left running in a day's log. Banks the
  // elapsed time capped at MAX_SESSION_SECONDS and records end_time at the cap,
  // so the row states when it was considered stopped rather than implying the
  // person worked through the night.
  public async closeOpenSessions(daily_log_id: string): Promise<number> {
    try {
      const running = await Task.findAll({
        where: { daily_log_id, status: "in_progress" },
      });
      let closed = 0;
      for (const task of running) {
        if (!isSessionOpen(task.start_time, task.end_time)) continue;
        const started = new Date(task.start_time!).getTime();
        const elapsed = Math.round((Date.now() - started) / 1000);
        const banked = Math.min(Math.max(0, elapsed), MAX_SESSION_SECONDS);
        task.total_seconds = (task.total_seconds ?? 0) + banked;
        task.total_time = formatDuration(task.total_seconds);
        task.end_time = new Date(started + banked * 1000);
        task.updated_at = new Date();
        // Explicit field list. Without it save() writes every attribute
        // Sequelize believes is dirty, and `comments` is a JSONB column loaded
        // into this instance — a save that carried it would push a snapshot
        // taken before someone else's comment landed, silently deleting it.
        // Comments are only ever written by TaskCommentRepository, in SQL.
        await task.save({
          fields: ["total_seconds", "total_time", "end_time", "updated_at"],
        });
        closed++;
      }
      return closed;
    } catch (error) {
      throw error;
    }
  }

  // `window` is one date-only string (the board asking for a single day), an
  // inclusive {from, to} range (§0), or nothing at all (every log, which is
  // what the board falls back to today by omitting the date entirely).
  public async findDailyLogs(
    window: string | DateRange | undefined,
    id: string,
    role?: string,
    assigned_to?: string
  ) {
    try {
      const dateWhere = dailyLogDateWhere(window);
      // Spread rather than assigned, so an absent window leaves the key off
      // the where clause entirely instead of matching `date: undefined`.
      const inWindow = dateWhere === undefined ? {} : { date: dateWhere };
      if (role == "SP") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              ...inWindow,
            },
          });
        }
        // SP sees all tasks
        return await DailyTaskLog.findAll({
          where: {
            ...inWindow,
          },
        });
      } else if (role == "AM") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              ...inWindow,
            },
          });
        }
        // Get all users/developers managed by this AM
        const managedUsers = await User.findAll({
          where: { manager_id: id },
          attributes: ["id"],
        });
        const managedUserIds = managedUsers.map((u: any) => u.id);
        // AM sees: tasks they created OR assigned to them OR assigned to their team members
        return await DailyTaskLog.findAll({
          where: {
            [Op.or]: [
              { created_by: id },
              { assigned_to: id },
              ...(managedUserIds.length > 0 ? [{ assigned_to: { [Op.in]: managedUserIds } }] : []),
            ],
            ...inWindow,
          },
        });
      } else {
        // USER/DEVELOPER: tasks assigned to them or created by them
        return await DailyTaskLog.findAll({
          where: {
            [Op.or]: [
              { assigned_to: id },
              { created_by: id },
            ],
            ...inWindow,
          },
        });
      }
    } catch (error) {
      throw error;
    }
  }
  public async findClosestPreviousLog(date: string, id: string) {
    try {
      return await DailyTaskLog.findAll({
        where: {
          assigned_to: id,
          date: {
            [Op.lt]: date,
          },
        },
        order: [["date", "DESC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  public async lockDailyTask(data: any) {
    try {
      const { date, id } = data;

      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        throw new Error("Invalid date input received");
      }

      const startOfDay = new Date(parsedDate);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(parsedDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const [_, updatedLogs] = await DailyTaskLog.update(
        {
          locked: true,
          locked_at: new Date(),
        },
        {
          where: {
            assigned_to: id,
            created_at: {
              [Op.between]: [startOfDay, endOfDay],
            },
          },
          returning: true,
        }
      );

      const dailyLogIds = updatedLogs.map((log: any) => log.id);

      if (dailyLogIds.length === 0) {
        return {
          message: "No daily task logs found to lock",
          dailyTaskLog: [],
          tasks: [],
        };
      }

      const [__, updatedTasks] = await Task.update(
        {
          isLocked: true,
          updated_at: new Date(),
        },
        {
          where: {
            daily_log_id: {
              [Op.in]: dailyLogIds,
            },
          },
          returning: true,
        }
      );

      return {
        message: "Daily tasks and associated tasks locked successfully",
        dailyTaskLog: updatedLogs,
        tasks: updatedTasks,
      };
    } catch (error) {
      console.error("lockDailyTask error:", error);
      throw error;
    }
  }

  // `scope` widens WHICH parents come back, and nothing else — the row that
  // comes back is still the whole parent with all of its subtasks nested, so a
  // member who is only on subtask 3 still sees who is ahead of them and
  // whether that person has finished (§3).
  //
  //   parentIds  parents whose CHILD sits in one of the caller's daily logs
  //   roomIds    rooms the caller is an active member of
  //   roomLogIds the daily logs of the date being asked for, which bounds the
  //              room rule to this day's board instead of the room's history
  public async todayTask(
    ids: string[] | string,
    projectId?: string,
    offset?: number,
    limit?: number,
    status?: string | string[],
    scope?: { parentIds?: string[]; roomIds?: string[]; roomLogIds?: string[] }
  ): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids];

      // Rule 1 and 3 of §3 together: the caller's own daily logs already cover
      // "assigned to me" and "created by me", because findDailyLogs selects on
      // assigned_to OR created_by.
      const visibility: any[] = [{ daily_log_id: { [Op.in]: idArray } }];

      // Rule 2: assignee of any of its subtasks.
      if (scope?.parentIds?.length) {
        visibility.push({ id: { [Op.in]: scope.parentIds } });
      }

      // The authorization decision of §3, taken as suggested: a task with a
      // room_id is readable by every ACTIVE member of that room; a task
      // without one keeps the stricter daily-log rule above. Date-bounded, so
      // opening today's board does not pull in every task the room has ever
      // had.
      if (scope?.roomIds?.length && scope?.roomLogIds?.length) {
        visibility.push({
          room_id: { [Op.in]: scope.roomIds },
          daily_log_id: { [Op.in]: scope.roomLogIds },
        });
      }

      const whereClause: any = {
        [Op.or]: visibility,
        // Subtasks come back nested under their parent, never as their own row.
        parent_id: null,
      };
      if (projectId) {
        whereClause.project_id = projectId;
      }
      const statuses = parseStatusFilter(status);
      if (statuses) {
        whereClause[Op.and] = [
          ...((whereClause[Op.and] as any[]) ?? []),
          Sequelize.where(STATUS_SLUG, { [Op.in]: statuses }),
        ];
      }

      const queryOptions: any = {
        where: whereClause,
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
          },
          {
            model: TaskGroup,
            as: "group",
            attributes: ["id", "name", "color", "position"],
          },
          // Nested rather than listed alongside: a subtask is not its own
          // board card.
          subtaskInclude(),
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
              {
                model: User,
                as: "creator",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
        order: [TASK_STATUS_ORDER, ["created_at", "DESC"]],
      };

      if (offset !== undefined) queryOptions.offset = offset;
      if (limit !== undefined) queryOptions.limit = limit;

      const { count, rows } = await Task.findAndCountAll(queryOptions);

      return { tasks: rows, totalCount: count };
    } catch (error) {
      throw error;
    }
  }
  // The project board: every top-level task of one project, optionally bounded
  // to a window (§0). Without `window` this returns the project's whole
  // history — which is what the reports page is living on today, and why it
  // has to slice the result in the browser.
  public async tasksByProject(
    projectId: string,
    offset?: number,
    limit?: number,
    status?: string | string[],
    window?: string | DateRange
  ): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const statuses = parseStatusFilter(status);
      const whereClause: any = { project_id: projectId, parent_id: null };
      // The date lives on the daily log, not on the task, so bounding by a
      // window turns the dailyLog include into an INNER JOIN. A task with no
      // daily log has no date and so cannot be placed in a window at all.
      const dateWhere = dailyLogDateWhere(window);
      if (statuses) {
        whereClause[Op.and] = [
          Sequelize.where(STATUS_SLUG, { [Op.in]: statuses }),
        ];
      }

      const queryOptions: any = {
        where: whereClause,
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
          },
          {
            model: TaskGroup,
            as: "group",
            attributes: ["id", "name", "color", "position"],
          },
          // Nested rather than listed alongside: a subtask is not its own
          // board card.
          subtaskInclude(),
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to", "date"],
            ...(dateWhere === undefined
              ? {}
              : { required: true, where: { date: dateWhere } }),
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
              {
                model: User,
                as: "creator",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
        order: [TASK_STATUS_ORDER, ["created_at", "DESC"]],
      };

      if (offset !== undefined) queryOptions.offset = offset;
      if (limit !== undefined) queryOptions.limit = limit;

      const { count, rows } = await Task.findAndCountAll(queryOptions);
      return { tasks: rows, totalCount: count };
    } catch (error) {
      throw error;
    }
  }

  // A task belongs to exactly one lane: group_id set puts the card in that
  // group's lane, otherwise it sits in its status lane. Either field may be
  // absent, and absent means "leave unchanged" — a status-lane drop sends
  // group_id: null to unlink, a group drop sends no status at all.
  public async updateTaskLane(
    task: Task,
    changes: { status?: string; group_id?: string | null },
    transaction?: Transaction
  ): Promise<Task> {
    try {
      if (changes.status === undefined && changes.group_id === undefined) {
        throw new Error("Nothing to update: send status, group_id or both");
      }
      const now = new Date();

      if (changes.status !== undefined) {
        // Since 009 this column also holds group names, so the value arrives
        // already resolved by the service: a client-sent status is validated
        // against VALID_TASK_STATUSES there, a group name is passed through.
        const wasRunning = task.status === "in_progress";
        const willRun = changes.status === "in_progress";
        // A session is open only while the clock is set and not yet closed.
        const startedAt = task.start_time;
        const sessionOpen = isSessionOpen(startedAt, task.end_time);

        // Starting or resuming. The second half matters for a task carried over
        // from yesterday: it arrives already in_progress with no clock, so
        // without this it could never be started again — and it cannot go back
        // to yet_to_start either.
        if (willRun && (!wasRunning || !sessionOpen)) {
          task.start_time = now;
          task.end_time = null;
        }

        // Stopping: bank this session, capped. Every pause and restart adds to
        // the total, so work spread across sessions still reports in full.
        if (wasRunning && !willRun && sessionOpen && startedAt) {
          const elapsed = Math.round(
            (now.getTime() - new Date(startedAt).getTime()) / 1000
          );
          task.total_seconds =
            (task.total_seconds ?? 0) +
            Math.min(Math.max(0, elapsed), MAX_SESSION_SECONDS);
          task.total_time = formatDuration(task.total_seconds);
          task.end_time = now;
        }

        if (changes.status === "completed") {
          task.end_time = now;
        }
        task.status = changes.status;
      }

      // Deliberately outside the status branch: parking a card in a group must
      // not stamp start_time/end_time or otherwise touch its status.
      if (changes.group_id !== undefined) {
        task.group_id = changes.group_id;
      }

      task.updated_at = now;
      // Explicit field list, same reason as closeOpenSessions: `comments` is a
      // JSONB column that this instance is holding a possibly-stale copy of,
      // and a bare save() would write it back and lose comments that landed in
      // between. Everything this method touches is listed.
      await task.save({
        fields: [
          "status",
          "group_id",
          "start_time",
          "end_time",
          "total_seconds",
          "total_time",
          "updated_at",
        ],
        transaction,
      });
      return task;
    } catch (error) {
      console.error("Error updating task lane:", error);
      throw error;
    }
  }

  // §4(b): the parent's status is derived from its children, on the SERVER.
  //
  // The frontend used to do this — first child to start set the parent
  // in_progress, last to finish set it completed. With three people acting from
  // three browsers that races and the parent ends up wrong, so it now happens
  // here, inside the same transaction as the child's own update.
  //
  // Derivation:
  //   every child completed          -> completed
  //   any child started or finished  -> in_progress
  //   otherwise (all yet_to_start)   -> left alone
  //
  // FORWARD ONLY. A parent never moves back: `blocked` on a child does not
  // reopen a completed parent, and a parent parked in a custom group lane
  // ("Production") is left entirely alone — since 009 status IS the lane name,
  // so writing a status over it would silently pull the card out of its lane.
  //
  // Returns the parent when it changed, and the unchanged parent otherwise, so
  // the caller can hand it straight back to the client either way. Null only
  // when the parent has vanished.
  public async rollUpParentStatus(
    parent_id: string,
    transaction?: Transaction
  ): Promise<Task | null> {
    try {
      const parent = await Task.findByPk(parent_id, { transaction });
      if (!parent) return null;

      // A locked day is frozen, and the parent now lives in a DIFFERENT daily
      // log from its children — each child sits in its assignee's log. So the
      // parent's log can be locked while a child's is not, and the roll-up
      // would be the one write that slipped past the lock. Returned unchanged
      // rather than thrown: the child's own transition is legitimate and must
      // still succeed.
      if (parent.isLocked) return parent;

      const current = String(parent.status ?? "").toLowerCase().trim();
      // A group lane is not a status; leave it.
      if (!REAL_STATUS_SET.has(current)) return parent;
      // Nothing rolls a completed parent back open.
      if (current === "completed") return parent;

      const children = await Task.findAll({
        where: { parent_id },
        attributes: ["id", "status"],
        transaction,
        raw: true,
      });
      if (!children.length) return parent;

      const statuses = children.map((c: any) =>
        String(c.status ?? "").toLowerCase().trim()
      );
      const allCompleted = statuses.every((st) => st === "completed");
      const anyStarted = statuses.some(
        (st) => st === "in_progress" || st === "completed"
      );

      const target = allCompleted
        ? "completed"
        : anyStarted
        ? "in_progress"
        : undefined;
      if (!target || target === current) return parent;

      // Only ever forward along yet_to_start -> in_progress -> completed.
      const from = STATUS_RANK_ORDER[current];
      const to = STATUS_RANK_ORDER[target];
      if (from === undefined || to === undefined || to <= from) return parent;

      // Through updateTaskLane so the parent's own clock is handled the same
      // way a manual transition handles it: its timer starts when the first
      // child starts and banks when the last child finishes.
      return await this.updateTaskLane(parent, { status: target }, transaction);
    } catch (error) {
      console.error("Error rolling up parent status:", error);
      throw error;
    }
  }
}
