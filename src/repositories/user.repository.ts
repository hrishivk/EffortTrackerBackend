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

export const MAX_SESSION_SECONDS = 8 * 60 * 60;

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
          {
            model: Task,
            as: "subtasks",
            separate: true,
            order: [["created_at", "ASC"]],
          },
        ],
      });
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
      const { dailyTaskLog, project_id, description, priority, end_time, start_time, start_date, due_date, group_id, room_id, parent_id, tags, status } = data;
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
        await task.save();
        closed++;
      }
      return closed;
    } catch (error) {
      throw error;
    }
  }

  public async findDailyLogs(date: string, id: string, role?: string, assigned_to?: string) {
    try {
      const formattedDate = date.split("T")[0];
      if (role == "SP") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              date: formattedDate,
            },
          });
        }
        // SP sees all tasks
        return await DailyTaskLog.findAll({
          where: {
            date: formattedDate,
          },
        });
      } else if (role == "AM") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              date: formattedDate,
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
            date: formattedDate,
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
            date: formattedDate,
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

  public async todayTask(ids: string[] | string, projectId?: string, offset?: number, limit?: number, status?: string | string[]): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids];
      const whereClause: any = {
        daily_log_id: {
          [Op.in]: idArray,
        },
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
          {
            // Nested rather than listed alongside: a subtask is not its own
            // board card.
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
            ],
            order: [["created_at", "ASC"]],
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
  public async tasksByProject(projectId: string, offset?: number, limit?: number, status?: string | string[]): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const statuses = parseStatusFilter(status);
      const whereClause: any = { project_id: projectId, parent_id: null };
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
          {
            // Nested rather than listed alongside: a subtask is not its own
            // board card.
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
            ],
            order: [["created_at", "ASC"]],
          },
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to", "date"],
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
    changes: { status?: string; group_id?: string | null }
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
      await task.save();
      return task;
    } catch (error) {
      console.error("Error updating task lane:", error);
      throw error;
    }
  }
}
