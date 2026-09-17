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
import { DateRange } from "../utils/dateRange";
import { Database } from "../connection/db/dbConnection";
import { Transaction } from "sequelize";
import { TaskNotificationService } from "./task-notification.service";
import {
  capComments,
  collectCommentUserIds,
  decorateTask,
  decorateTasks,
  statusSlug,
  UserLite,
} from "../utils/taskView";
const userRepository = new UserRepository();
const taskGroupRepository = new TaskGroupRepository();
const workspaceRepository = new WorkspaceRepository();
const taskNotifications = new TaskNotificationService();

// Raised when a subtask is started out of turn on a sequential parent. Carries
// its own name so the controller can answer 409 without matching on the
// message text - the message is written to be shown to the user as-is
// ("Build the UI can't start until Design the screens is completed"), so it
// must be free to change without breaking the status mapping.
export class SequentialBlockedError extends Error {
  public readonly name = "SequentialBlockedError";
}

// Raised by the create path when a subtask names somebody who is not a member
// of the room. Names the offending index, because the picker only offers room
// members - a failure here means something is out of date on the client, and
// saying which row is out of date is the whole point of the check.
export class SubtaskValidationError extends Error {
  public readonly name = "SubtaskValidationError";
}

// Resolves the comment authors for a page of tasks in one query, so the names
// cost one round trip for the whole response rather than one per comment.
const commentAuthorsFor = async (
  rows: any[]
): Promise<Map<string, UserLite>> => {
  const ids = collectCommentUserIds(rows);
  if (!ids.length) return new Map();
  const users = await userRepository.findUsersLite(ids);
  return new Map(users.map((u: any) => [u.id, u as UserLite]));
};


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
                // Both carried, or an unfinished room task comes back the next
                // morning off its room board and with its ordering rule
                // dropped — the children would all become startable at once.
                room_id: task.dataValues.room_id,
                sequential: task.dataValues.sequential,
              });

              // Subtasks come with their parent, re-parented to the new copy.
              // Without this they would be skipped entirely, because todayTask
              // only returns parents — and if they were carried as top-level
              // tasks instead they would each become their own board card.
              // Finished subtasks stay behind, same rule as their parent.
              //
              // Each child is carried into ITS OWN assignee's log for the new
              // date, not into the log of whoever happens to be logging in.
              // Copying them all into this user's log would quietly hand three
              // people's work to one person overnight, which is precisely what
              // per-subtask assignment exists to prevent. This user's login is
              // the only one that can carry them: a member's own login sees
              // only parent rows in their log, and a child is not one.
              const subtasks: any[] = (task as any).subtasks ?? [];
              const carryLogs = new Map<string, any>([[id, todayLog]]);
              for (const sub of subtasks) {
                const subStatus = String(sub.status ?? "").toLowerCase().trim();
                if (subStatus === "completed") continue;

                const subAssignee: string =
                  sub.dailyLog?.assigned_to ??
                  sub.dailyLog?.dataValues?.assigned_to ??
                  id;
                let subLog = carryLogs.get(subAssignee);
                if (!subLog) {
                  const existing = await userRepository.findDailyLogs(
                    formattedToday,
                    subAssignee
                  );
                  subLog =
                    existing?.find(
                      (log: any) =>
                        (log.assigned_to ?? log.dataValues?.assigned_to) ===
                        subAssignee
                    ) ??
                    (await userRepository.createDailyTaskLog(
                      id,
                      subAssignee,
                      formattedToday,
                      sub.project_id ?? task.project_id
                    ));
                  carryLogs.set(subAssignee, subLog);
                }
                // A locked day stays locked; the subtask simply does not carry.
                if (subLog?.dataValues?.locked) continue;

                await userRepository.createNewTask({
                  dailyTaskLog: subLog,
                  project_id: sub.project_id ?? task.project_id,
                  description: sub.description,
                  priority: sub.priority,
                  status: CARRY_OVER_STATUS,
                  start_date: sub.start_date,
                  due_date: sub.due_date,
                  parent_id: carried.id,
                  tags: sub.tags,
                  room_id: sub.room_id ?? task.dataValues.room_id,
                  // Kept, so the order survives the night. Without it every
                  // carried child would sit on 0 and none would block another.
                  position: sub.position,
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
  // Returns the decorated read model, not a bare Task instance: the create
  // modal renders the card it just made from this response, so it needs the
  // same per-child assignee / position / is_blocked shape /task-list returns.
  public async addTask(data: AddTask): Promise<any> {
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

      // Every subtasks[].assigned_to must be an ACTIVE member of the room, and
      // the check runs BEFORE anything is written: a payload with one bad
      // assignee creates no task at all, rather than a main task with a hole
      // where somebody's subtask should be.
      //
      // Active members only, so a pending join request cannot be handed work.
      // Without a room_id there is no membership list to check against, and a
      // per-subtask assignee is then validated only for existence — the
      // stricter rule would break assigning subtasks outside a room, which
      // this endpoint has always allowed.
      const subtaskInputs = data.subtasks ?? [];
      const namedAssignees = subtaskInputs
        .map((sub) => sub.assigned_to)
        .filter((v): v is string => !!v);

      if (namedAssignees.length) {
        const allowed = resolvedRoomId
          ? new Set(
              await workspaceRepository.activeRoomMemberIds(resolvedRoomId)
            )
          : null;
        const missing = allowed
          ? []
          : await workspaceRepository.missingUserIds(namedAssignees);

        for (let i = 0; i < subtaskInputs.length; i++) {
          const who = subtaskInputs[i].assigned_to;
          if (!who) continue;
          if (allowed && !allowed.has(who)) {
            throw new SubtaskValidationError(
              `subtasks[${i}].assigned_to (${who}) is not a member of room ${resolvedRoomId}`
            );
          }
          if (!allowed && missing.includes(who)) {
            throw new SubtaskValidationError(
              `subtasks[${i}].assigned_to (${who}) is not a known user`
            );
          }
        }
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
        // Set on the MAIN task, so its children run in position order. Only
        // meaningful on a parent; harmless (and false) everywhere else.
        sequential: data.sequential,
      });

      // One daily log per assignee, cached so three subtasks for the same
      // person do not each cost a lookup.
      //
      // This is what actually splits a task across people. Assignment is not a
      // column on tasks — it lives on the daily log's (created_by, assigned_to)
      // pair, the same place the rest of the app reads it from as
      // dailyLog.assignedUser. So a subtask with its own assignee gets its own
      // log, and the three children of one parent sit in three different
      // people's logs while remaining children of one row.
      const logsByAssignee = new Map<string, any>();
      if (assigned_to) logsByAssignee.set(assigned_to, dailyTaskLog);

      const logFor = async (assignee: string) => {
        const cached = logsByAssignee.get(assignee);
        if (cached) return cached;
        let log = await userRepository.findDailyTaskLog(
          dailytaskTime,
          created_by,
          assignee
        );
        if (!log) {
          log = await userRepository.createDailyTaskLog(
            created_by,
            assignee,
            dailytaskTime,
            resolvedProjectId
          );
        }
        if (log?.dataValues?.locked) {
          throw new Error("Daily log is locked. Cannot add new task.");
        }
        logsByAssignee.set(assignee, log);
        return log;
      };

      const createdSubtasks: Array<{
        task: Task;
        assignee: string | undefined;
      }> = [];

      for (let index = 0; index < subtaskInputs.length; index++) {
        const sub = subtaskInputs[index];
        const subDescription = (sub.description ?? sub.name ?? "").trim();
        if (!subDescription) continue;
        const subStatus = sub.status === "pending" ? "yet_to_start" : sub.status;

        // No assignee falls back to the parent's log, which is exactly the
        // pre-feature behaviour: the subtask belongs to whoever owns the parent.
        const assignee = sub.assigned_to;
        const subLog = assignee ? await logFor(assignee) : dailyTaskLog;

        const created = await userRepository.createNewTask({
          dailyTaskLog: subLog,
          project_id: resolvedProjectId,
          description: subDescription,
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
          // 1-based on the array index when the caller sends no position, so a
          // client that simply lists them in order gets the ordering it meant.
          // An explicit position wins, including a deliberate tie.
          position:
            sub.position !== undefined && sub.position !== null
              ? Number(sub.position)
              : index + 1,
        });
        createdSubtasks.push({ task: created, assignee });
      }

      // Section 6, event 1: "a subtask is assigned to you".
      //
      // After every write, so a notification failure cannot leave a
      // half-created task behind. TaskNotificationService swallows its own
      // errors for the same reason.
      const [actor] = created_by
        ? await userRepository.findUsersLite([created_by])
        : [];
      for (const { task, assignee } of createdSubtasks) {
        if (!assignee) continue;
        await taskNotifications.subtaskAssigned({
          assignee_id: assignee,
          actor_id: created_by,
          actor_name: (actor as any)?.fullName ?? null,
          subtask_description: (task as any).description,
          parent_description: description,
          parent_id: parentTask.id,
          position: (task as any).position,
          sequential: (parentTask as any).sequential === true,
        });
      }

      // Re-read so the response carries the subtasks; fall back to the row we
      // just created if the re-read somehow misses.
      const newTask = await userRepository.findTaskWithSubtasks(parentTask.id);
      if (!newTask) return parentTask;

      // The same read model /task-list returns, so the modal can render the
      // card it just created without a second request: every child carries its
      // own assignee, position, is_blocked and blocked_by.
      const authors = await commentAuthorsFor([newTask]);
      return decorateTask(newTask, authors);
    } catch (error: any) {
      console.error(" Error in addTask:", error.message);
      throw new Error(error.message || "Failed");
    }
  }
  // Returns the decorated read model rather than raw Task instances — see
  // utils/taskView. The shape is a superset of what it used to return.
  public async listTask(data: any): Promise<{ data: any[]; totalPages: number }> {
    try {
      const { date, range, id, role, assigned_to, project, status, page = 1, limit = 10 } = data;
      const skip = (page - 1) * limit;

      // §0. Downstream, one date and an inclusive {from, to} window are the
      // same thing: a predicate on daily_task_logs.date. `range` wins when a
      // caller sends both, and neither means "no date predicate" — the
      // unbounded read the board falls back to today.
      const window: string | DateRange | undefined = range ?? date;

      let projectId: string | undefined;
      if (project) {
        const projectRecord = await Project.findOne({ where: { name: project } });
        if (projectRecord) projectId = projectRecord.id;
      }


      // The project view: every top-level task of the project, not just the
      // caller's. Selected on `date` alone rather than on `window`, so adding
      // from/to to a project request BOUNDS the view it already had instead of
      // quietly narrowing it to the caller's own tasks — the numbers on the
      // reports page would move for a reason nobody asked for.
      if (!date && projectId) {
        const { tasks, totalCount } = await userRepository.tasksByProject(projectId, skip, limit, status, range);
        return {
          data: decorateTasks(tasks, await commentAuthorsFor(tasks)),
          totalPages: Math.ceil(totalCount / limit),
        };
      }

      const todayLog = await userRepository.findDailyLogs(window, id, role, assigned_to as string);
      const logIds = (todayLog ?? []).map((log: any) => log.id);

      // Section 3 — who gets the task. The old rule was "the daily logs you
      // own", which scoped by assignee and so showed the main task to nobody
      // but the parent's owner: the other two members of a shared task saw
      // nothing at all.
      //
      // Rules 1 and 3 ("assigned to me", "created by me") are already covered
      // by findDailyLogs, which selects on assigned_to OR created_by. The two
      // widenings below add rule 2 and the room read.
      //
      // Rule 2: any parent one of MY subtasks hangs off. The parent still comes
      // back whole, with all of its subtasks, so somebody who is only on
      // subtask 3 can still see who is ahead of them and whether that person
      // has finished.
      const parentIds = await userRepository.parentIdsForChildLogs(logIds);

      // The authorization decision, taken as suggested: a task with a room_id
      // is readable by every active member of that room; a task without one
      // keeps the stricter daily-log rule. SP is skipped because findDailyLogs
      // already hands them every log for the date.
      //
      // roomLogIds bounds it to the days being asked for. Without that bound,
      // opening the board would drag in every task the room has ever had.
      const roomIds =
        role === "SP" ? [] : await workspaceRepository.roomIdsForUser(id);
      const roomLogIds =
        roomIds.length && window ? await userRepository.logIdsForWindow(window) : [];

      // Nothing to look in and no room to look through: the caller genuinely
      // has no board for this date. Checked after the widenings rather than
      // straight off findDailyLogs, so a room member with no log of their own
      // still sees the room's tasks.
      if (!logIds.length && !(roomIds.length && roomLogIds.length)) {
        throw new Error("No task found");
      }

      const { tasks, totalCount } = await userRepository.todayTask(
        logIds,
        projectId,
        skip,
        limit,
        status,
        { parentIds, roomIds, roomLogIds }
      );

      return {
        data: decorateTasks(tasks, await commentAuthorsFor(tasks)),
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

      const parentId: string | null = (task as any).parent_id ?? null;

      // One transaction around the order check, the child's own update and the
      // parent roll-up. Section 4(b): the roll-up used to happen in the
      // frontend, where three people acting from three browsers raced and left
      // the parent on the wrong status.
      const sequelize = Database.getSequelize();
      const { updated, parent } = await sequelize.transaction(
        async (t: Transaction) => {
          // Section 4(a): enforce the order. Inside the transaction and after
          // a fresh read of the siblings, so this is a real backstop for two
          // people clicking Start in the same moment and not just a repeat of
          // the check the UI already made.
          if (parentId && effectiveStatus === "in_progress") {
            const parentRow = await userRepository.findTaskRaw(parentId, t);
            if (parentRow && (parentRow as any).sequential === true) {
              const siblings = await userRepository.findChildren(parentId, t);
              const myPosition = Number((task as any).position ?? 0);
              const blocker = siblings.find(
                (sibling: any) =>
                  Number(sibling.position ?? 0) < myPosition &&
                  statusSlug(sibling.status) !== "completed"
              );
              if (blocker) {
                // Written to be shown to the user as-is.
                throw new SequentialBlockedError(
                  `${(task as any).description} can't start until ${
                    (blocker as any).description
                  } is completed`
                );
              }
            }
          }

          const child = await userRepository.updateTaskLane(
            task,
            { status: effectiveStatus, group_id },
            t
          );

          const rolled = parentId
            ? await userRepository.rollUpParentStatus(parentId, t)
            : null;

          return { updated: child, parent: rolled };
        }
      );

      // Section 6, event 2 — the important one. Raised after the commit, so
      // the person told it is their turn can actually start when they act on
      // it, and so a notification failure cannot roll back a completed
      // subtask.
      if (parentId && statusSlug(effectiveStatus) === "completed" && parent) {
        const siblings = await userRepository.findChildren(parentId);
        await taskNotifications.subtaskUnblocked({
          parent,
          children: siblings,
          completed_child: updated,
        });
      }

      // The updated child, plus the parent as the server now has it. `parent`
      // is the whole card with every subtask re-decorated, so the board can
      // replace it outright instead of patching a status it guessed at. Null
      // for a top-level task.
      //
      // Additive: everything the response carried before is still on the
      // object at the same key.
      const parentView = parent
        ? await userRepository.findTaskWithSubtasks((parent as any).id)
        : null;

      // capComments rather than decorateTask on the child: this read does not
      // fetch its subtasks, and decorateTask would report `subtasks: []`, which
      // a client holding a real list would read as "all deleted". It does keep
      // the comment array from arriving uncapped on every status click.
      const authors = await commentAuthorsFor(
        parentView ? [updated, parentView] : [updated]
      );

      return {
        ...capComments(updated, authors),
        parent: parentView ? decorateTask(parentView, authors) : null,
      };
    } catch (error) {
      console.error("Error in updateStatus:", error);
      throw error;
    }
  }
}
