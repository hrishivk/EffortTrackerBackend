import {
  UserRepository,
  normalizeTaskStatus,
  statusForGroup,
} from "../repositories/user.repository";
import { TaskGroupRepository } from "../repositories/task-group.repository";
import { WorkspaceRepository } from "../repositories/workspace.repository";
import {
  AddTask,
  LoginResponse,
} from "../types/user.types";


import { TaskStatusUpdate, TaskWithDailyLog } from "../types/task.types";
import { Task } from "../connection/models/tasks";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { Project } from "../connection/models/project";
const userRepository = new UserRepository();
const taskGroupRepository = new TaskGroupRepository();
const workspaceRepository = new WorkspaceRepository();


// Status advances one step at a time along yet_to_start -> in_progress ->
// completed. A transition is legal only if the target is the same rank or
// exactly one above, so work cannot skip a stage (yet_to_start straight to
// completed) or move backwards (reopening a completed task).
//
// A custom group lane ("Production") is reachable only from completed: work has
// to be finished before it can be parked there. Without that rule the sequence
// could be skipped by routing through a group, since since 009 status IS the
// lane name and no longer remembers the state the card came from.
//
// "blocked" is a real status rather than a lane, so it stays freely reachable —
// requiring a task to be completed before it can be blocked would be nonsense.
// Yesterday's work does not arrive already running: the clock was banked and
// closed at login, so the new day's copy starts from not-started. An
// in_progress task therefore carries over as yet_to_start, and a yet_to_start
// one stays as it was.
const CARRY_OVER_STATUS = "yet_to_start";

const STATUS_RANK: Record<string, number> = {
  yet_to_start: 0,
  in_progress: 1,
  completed: 2,
};

// The four real statuses, as opposed to a group name being stored in status.
const REAL_STATUSES = new Set([
  "yet_to_start",
  "in_progress",
  "completed",
  "blocked",
]);

export const assertForwardTransition = (from?: string, to?: string) => {
  if (!from || !to) return;
  const a = STATUS_RANK[String(from).toLowerCase().trim()];
  const b = STATUS_RANK[String(to).toLowerCase().trim()];
  const fromSlug = String(from).toLowerCase().trim();
  const toSlug = String(to).toLowerCase().trim();
  const fromIsGroupLane = a === undefined && !REAL_STATUSES.has(fromSlug);
  const toIsGroupLane = b === undefined && !REAL_STATUSES.has(toSlug);

  // A group lane is terminal: once parked, a card cannot be pulled back onto
  // yet_to_start, in_progress or completed. "blocked" is included, otherwise
  // Production -> blocked -> yet_to_start would reopen the same back door.
  // Moving between two group lanes is still fine.
  if (fromIsGroupLane && !toIsGroupLane) {
    throw new Error("A task in a group cannot be moved back to a status");
  }

  // Moving from a real status into a custom group lane.
  if (a !== undefined && b === undefined && !REAL_STATUSES.has(toSlug)) {
    if (a !== STATUS_RANK.completed) {
      throw new Error("A task must be completed before it can be moved to a group");
    }
    return;
  }

  if (a === undefined || b === undefined) return;
  if (b === a || b === a + 1) return;
  if (b > a) {
    throw new Error("A task must be started before it can be completed");
  }
  if (a === STATUS_RANK.completed) {
    throw new Error("A completed task cannot be reopened");
  }
  throw new Error("A task in progress cannot go back to yet to start");
};

export class userService {
  public async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const user = (await userRepository.findUserByEmail(email)) as any;

      if (!user) {
        throw new Error("User not found");
      }
      if (user.dataValues.isBlocked) {
        throw new Error("Your account has been blocked ");
      }
      const isValid = await userRepository.verifyPassword(
        password,
        user.dataValues.password
      );
      if (!isValid) {
        throw new Error("Invalid Password");
      }
      await userRepository.setUserActive(user.id as string);
      const { id, role, email: userEmail, fullName } = user.dataValues;
      const token = await userRepository.secureToken(id, user.email, role);
      const today = new Date();
      const formattedToday = today.toISOString().split("T")[0];
      let todayLogs = await userRepository.findDailyLogs(formattedToday, id);
      let todayLog: DailyTaskLog | null = todayLogs.length > 0 ? todayLogs[0] : null;
      if (!todayLog) {
        const previousLogs = await userRepository.findClosestPreviousLog(
          formattedToday,
          id
        );
        if (previousLogs && previousLogs.length > 0) {
          const previousLog = previousLogs[0];
          await userRepository.closeOpenSessions(previousLog.id);

          const { tasks: previousTasks } = await userRepository.todayTask(previousLog.id);
          const carryOverTasks = previousTasks.filter((task: any) => {
            const status = task.dataValues.status?.toLowerCase().trim();
            return status === "in_progress" || status === "yet_to_start";
          });
          if (carryOverTasks.length > 0) {
            const today = new Date();
            const formattedToday = today.toISOString().split("T")[0];
            const carryLane = await taskGroupRepository.findVisibleLaneForStatus(
              id,
              CARRY_OVER_STATUS
            );
            const carriedProjectId =
              (previousLog as any).project_id ??
              carryOverTasks[0]?.dataValues?.project_id ??
              undefined;
            todayLog = await userRepository.createDailyTaskLog(
              undefined,
              id,
              formattedToday,
              carriedProjectId
            );
            for (const task of carryOverTasks) {

              // Every carried task lands in the lane matching the status it
              // arrives on, so nothing comes across without a lane — whether it
              // was in a status-named lane yesterday or in none at all. A custom
              // lane ("Production") is the one exception and is kept as-is,
              // though it cannot reach here in practice: a custom lane is only
              // reachable from completed, and completed work does not carry.
              let groupId: string | null = carryLane?.id ?? null;
              const sourceGroupId: string | null =
                task.dataValues.group_id ?? null;
              if (sourceGroupId) {
                const source = await taskGroupRepository.findById(sourceGroupId);
                const mapped = source ? statusForGroup(source.name) : undefined;
                const isStatusLane =
                  !!mapped &&
                  ["yet_to_start", "in_progress", "completed", "blocked"].includes(
                    mapped
                  );
                if (!isStatusLane) groupId = sourceGroupId;
              }

              const carried = await userRepository.createNewTask({
                dailyTaskLog: todayLog,
                project_id: task.project_id,
                description: task.description,
                priority: task.priority,
                status: CARRY_OVER_STATUS,
                group_id: groupId,
                start_date: task.dataValues.start_date,
                due_date: task.dataValues.due_date,
                tags: task.dataValues.tags,
              });

              // Subtasks come with their parent, re-parented to the new copy.
              // Without this they would be skipped entirely, because todayTask
              // only returns parents — and if they were carried as top-level
              // tasks instead they would each become their own board card.
              // Finished subtasks stay behind, same rule as their parent.
              const subtasks: any[] = (task as any).subtasks ?? [];
              for (const sub of subtasks) {
                const subStatus = String(sub.status ?? "").toLowerCase().trim();
                if (subStatus === "completed") continue;
                await userRepository.createNewTask({
                  dailyTaskLog: todayLog,
                  project_id: sub.project_id ?? task.project_id,
                  description: sub.description,
                  priority: sub.priority,
                  status: CARRY_OVER_STATUS,
                  start_date: sub.start_date,
                  due_date: sub.due_date,
                  parent_id: carried.id,
                  tags: sub.tags,
                });
              }
            }
          }
        }
      }
      return {
        user: {
          id,
          role,
          email,
          fullName,
        },
        token,
      };
    } catch (error: any) {
      console.log(error);
      throw new Error(error.message || "Login failed");
    }
  }

  // sid is optional: a token minted before the claim existed has none, and a
  // logout must still succeed. Nothing is cleared in that case, and the 16-hour
  // age sweep collects the rows instead.
  public async logout(id: string, sid?: string) {
    try {
      // Session-scoped workspace unlocks end with the session, so the key is
      // asked for again on the next login. Done before the user update so a
      // failure here surfaces rather than leaving stale unlocks behind a
      // successful logout.
      if (sid) {
        await workspaceRepository.clearUnlocksForSession(sid);
      }
      return await userRepository.setUserLogout(id as string);
    } catch (error: any) {
      throw new Error(error.message || "logout failed");
    }
  }
  public async addTask(data: AddTask): Promise<Task> {
    try {
      const { created_by, assigned_to, project, project_id, description, priority, end_time, start_date, due_date, status } = data;
      let resolvedProjectId = project_id;
      if (!resolvedProjectId && project) {
        const projectRecord = await Project.findOne({ where: { name: project } });
        if (!projectRecord) {
          throw new Error(`Project "${project}" not found`);
        }
        resolvedProjectId = projectRecord.id;
      }
      if (!resolvedProjectId) {
        throw new Error("Either project or project_id is required");
      }

      // Optional. Validated up front so a stale room id names itself instead of
      // surfacing as a foreign-key violation.
      let resolvedRoomId: string | null = null;
      if (data.room_id) {
        const room = await workspaceRepository.findRoom(data.room_id);
        if (!room) {
          throw new Error("Room not found");
        }
        resolvedRoomId = room.id;
      }

      const dailytaskTime = new Date().toISOString().split("T")[0];
      let dailyTaskLog = await userRepository.findDailyTaskLog(
        dailytaskTime,
        created_by,
        assigned_to
      );

      if (!dailyTaskLog) {
        dailyTaskLog = await userRepository.createDailyTaskLog(
          created_by,
          assigned_to,
          dailytaskTime,
          resolvedProjectId
        );
      }
      if (dailyTaskLog?.dataValues.locked) {
        throw new Error("Daily log is locked. Cannot add new task.");
      }


      const taskStatus = status === "pending" ? "yet_to_start" : status;

 
      const normalizedPriority = priority
        ? priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase()
        : priority;

      const parentTask = await userRepository.createNewTask({
        created_by,
        assigned_to,
        dailyTaskLog,
        project_id: resolvedProjectId,
        description,
        priority: normalizedPriority,
        end_time,
        start_date,
        due_date,
 
        start_time:
          taskStatus === "in_progress" ? new Date().toISOString() : undefined,
        status: taskStatus,
        parent_id: data.parent_id ?? null,
        room_id: resolvedRoomId,
        tags: data.tags,
      });

      for (const sub of data.subtasks ?? []) {
        const description = (sub.description ?? sub.name ?? "").trim();
        if (!description) continue;
        const subStatus = sub.status === "pending" ? "yet_to_start" : sub.status;
        await userRepository.createNewTask({
          dailyTaskLog,
          project_id: resolvedProjectId,
          description,
          priority: sub.priority
            ? sub.priority.charAt(0).toUpperCase() +
              sub.priority.slice(1).toLowerCase()
            : normalizedPriority,
          start_date: sub.start_date,
          due_date: sub.due_date,
          status: subStatus ?? "yet_to_start",
          parent_id: parentTask.id,
          // A subtask is the same piece of work as its parent, so it belongs to
          // the same room. Leaving it null would put the parent on a room board
          // and its children nowhere.
          room_id: resolvedRoomId,
          tags: sub.tags ?? data.tags,
        });
      }

      // Re-read so the response carries the subtasks; fall back to the row we
      // just created if the re-read somehow misses.
      const newTask =
        (await userRepository.findTaskWithSubtasks(parentTask.id)) ?? parentTask;
      return newTask;
    } catch (error: any) {
      console.error(" Error in addTask:", error.message);
      throw new Error(error.message || "Failed");
    }
  }
  public async listTask(data: any): Promise<{ data: Task[]; totalPages: number }> {
    try {
      const { date, id, role, assigned_to, project, status, page = 1, limit = 10 } = data;
      const skip = (page - 1) * limit;

      let projectId: string | undefined;
      if (project) {
        const projectRecord = await Project.findOne({ where: { name: project } });
        if (projectRecord) projectId = projectRecord.id;
      }


      if (!date && projectId) {
        const { tasks, totalCount } = await userRepository.tasksByProject(projectId, skip, limit, status);
        return {
          data: tasks,
          totalPages: Math.ceil(totalCount / limit),
        };
      }

      const todayLog = await userRepository.findDailyLogs(date, id, role, assigned_to as string);
      if (!todayLog || todayLog.length === 0) {
        throw new Error("No task found");
      }
      const logIds = todayLog.map((log: any) => log.id);

      const { tasks, totalCount } = await userRepository.todayTask(logIds, projectId, skip, limit, status);
      console.log('taskss',tasks)

      return {
        data: tasks,
        totalPages: Math.ceil(totalCount / limit),
      };
    } catch (error) {
      console.error("Error in listTask:", error);
      throw error;
    }
  }

  public async lockDailyTask(data: any) {
    try {
      const locked = await userRepository.lockDailyTask(data);
      const todayLog = await userRepository.findDailyLogs(data.date, data.id);
      if (!todayLog) {
        throw new Error("No task found");
      }
      return locked;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  public async updateStatus(data: TaskStatusUpdate) {
    try {
      const { id, status } = data;
      // An empty string would reach the FK as a bogus id; treat it as a clear.
      const group_id = data.group_id === "" ? null : data.group_id;
      if (status === undefined && group_id === undefined) {
        throw new Error("Nothing to update: send status, group_id or both");
      }
      const task = (await userRepository.findTask(id)) as TaskWithDailyLog;
      if (!task) throw new Error("Task not found");
      if (task.isLocked) {
        throw new Error("Daily log is locked. Cannot update task status.");
      }
      let derivedStatus: string | undefined;
      if (group_id) {
        const group = await taskGroupRepository.findById(group_id);
        if (!group) throw new Error("Group not found");
        const dailyLog: any =
          (task as any).dailyLog ?? task.dataValues?.dailyLog;
        const boardOwner =
          dailyLog?.assigned_to ?? dailyLog?.dataValues?.assigned_to;
        if (!group.is_shared && boardOwner && group.user_id !== boardOwner) {
          throw new Error("Group belongs to a different board");
        }
        derivedStatus = statusForGroup(group.name);
      }

      if (status !== undefined) {
        const [valid] = normalizeTaskStatus(status) ?? [];
        if (!valid) {
          throw new Error(
            "Invalid status. Expected one of: yet_to_start, in_progress, completed, blocked"
          );
        }
      }
      const effectiveStatus = status ?? derivedStatus;
      assertForwardTransition(task.dataValues.status, effectiveStatus);

      return await userRepository.updateTaskLane(task, {
        status: effectiveStatus,
        group_id,
      });
    } catch (error) {
      console.error("Error in updateStatus:", error);
      throw error;
    }
  }
}
