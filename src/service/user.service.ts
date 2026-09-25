import {
  UserRepository,
  normalizeTaskStatus,
  normalizeTags,
  statusForGroup,
} from "../repositories/user.repository";
import { TaskGroupRepository } from "../repositories/task-group.repository";
import { WorkspaceRepository } from "../repositories/workspace.repository";
import {
  AddTask,
  LoginResponse,
} from "../types/user.types";


import {
  SubtaskCreateInput,
  TaskStatusUpdate,
  TaskWithDailyLog,
} from "../types/task.types";
import { Task } from "../connection/models/tasks";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { Project } from "../connection/models/project";
import { DateRange, parseOptionalDateOnly } from "../utils/dateRange";
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

// Raised when a MAIN task is completed while one of its subtasks is still
// open. Named rather than message-matched for the same reason
// SequentialBlockedError is: the message counts the outstanding children and is
// shown to the user as-is, so it has to be free to change.
export class SubtaskOpenError extends Error {
  public readonly name = "SubtaskOpenError";
}

// Raised when the caller may see a task but may not destroy it. Answered as
// 403, so it is kept apart from the 400-shaped validation errors below.
export class TaskForbiddenError extends Error {
  public readonly name = "TaskForbiddenError";
}

// Raised by the edit and add-subtask paths for a payload the client should not
// have sent. Carries its own name so the controller answers 400 without
// matching on message text, the same trick SubtaskValidationError plays.
export class TaskValidationError extends Error {
  public readonly name = "TaskValidationError";
}

// tasks.priority is a Postgres ENUM('Low','Medium','High'). An unchecked value
// off req.body reaches the driver as invalid input syntax — a 500 describing
// the column — so it is validated here and answered as a 400 naming the three
// legal values.
const PRIORITIES = ["Low", "Medium", "High"];
const normalizePriority = (value?: string): string | undefined => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const raw = String(value).trim();
  const title = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (!PRIORITIES.includes(title)) {
    throw new TaskValidationError(
      `Invalid priority. Expected one of: ${PRIORITIES.join(", ")}`
    );
  }
  return title;
};

// An editable DATEONLY column. Three outcomes, not two: absent leaves the
// column alone, an explicit null or "" clears it, and anything else has to
// parse as a date. Clearing has to be expressible or a due date set by mistake
// could never be removed.
const parseEditableDate = (
  value: unknown,
  label: string
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  try {
    return parseOptionalDateOnly(value, label) ?? null;
  } catch (error: any) {
    throw new TaskValidationError(error?.message ?? `Invalid ${label}`);
  }
};

// Booleans arrive off req.body as "true" from a form and 1 from some clients,
// and `sequential` is a NOT NULL boolean column. Same coercion createNewTask
// applies on the create path.
const coerceBoolean = (value: unknown): boolean =>
  value === true || value === "true" || value === 1 || value === "1";

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

          // Does the task itself have work left on it?
          const isUnfinished = (row: any): boolean => {
            const status = statusSlug(row?.status ?? row?.dataValues?.status);
            return status === "in_progress" || status === "yet_to_start";
          };
          // Its children with work left. `!== completed` rather than the pair
          // above, matching the child loop below: a blocked subtask is still
          // outstanding work and comes across.
          const openChildrenOf = (task: any): any[] =>
            ((task as any).subtasks ?? []).filter(
              (sub: any) => statusSlug(sub.status) !== "completed"
            );

          // A parent carries when IT is unfinished, OR when any of its
          // subtasks is.
          //
          // The second half is the fix for a task that vanished overnight:
          // todayTask returns parents only, so reading the parent's status
          // alone meant a COMPLETED parent with an open subtask carried
          // nothing — the parent was filtered out, and the child went with it
          // because a child only ever carries underneath its parent. The state
          // is reachable by adding a subtask to a task that is already
          // completed, which nothing forbids.
          const carryOverTasks = previousTasks.filter(
            (task: any) => isUnfinished(task) || openChildrenOf(task).length > 0
          );
          if (carryOverTasks.length > 0) {
            const today = new Date();
            const formattedToday = today.toISOString().split("T")[0];
            // One lookup per distinct status, not per task. A carried-forward
            // parent keeps its own status, so this is no longer always the
            // yet_to_start lane.
            const laneCache = new Map<string, any>();
            const laneFor = async (status: string) => {
              if (!laneCache.has(status)) {
                laneCache.set(
                  status,
                  await taskGroupRepository.findVisibleLaneForStatus(id, status)
                );
              }
              return laneCache.get(status);
            };
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
              // An unfinished task restarts as yet_to_start. A task that is
              // only here because a SUBTASK is still open keeps its own status
              // — it is coming across as the container for that child, and
              // rewriting a completed parent to yet_to_start would reopen work
              // its owner had accepted.
              const carriedStatus = isUnfinished(task)
                ? CARRY_OVER_STATUS
                : String(task.dataValues.status);
              const carryLane = await laneFor(carriedStatus);

              // Every carried task lands in the lane matching the status it
              // arrives on, so nothing comes across without a lane — whether it
              // was in a status-named lane yesterday or in none at all. A custom
              // lane ("Production") is the one exception and is kept as-is.
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
                status: carriedStatus,
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
              //
              // The WHOLE set comes across, completed ones included, each
              // keeping what it was: a completed child carries as completed, an
              // unfinished one restarts as yet_to_start. Leaving the finished
              // ones behind made today's card claim 0 of 1 done on work that
              // was really 1 of 2 — the progress a manager reads off the card
              // would reset every night.
              //
              // The copy does NOT carry total_seconds, so a carried completed
              // child shows no time against today. That is deliberate: the
              // hours were banked on yesterday's row, and copying them would
              // count the same work twice in the reports.
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
                const subStatus = statusSlug(sub.status);
                // Completed stays completed; everything else — in_progress,
                // yet_to_start, blocked — restarts as yet_to_start, the same
                // rule the parent follows.
                const subCarriedStatus =
                  subStatus === "completed" ? "completed" : CARRY_OVER_STATUS;

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
                  status: subCarriedStatus,
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
      const { date, range, id, role, assigned_to, project, status, page = 1, limit = 10, minExtensions } = data;
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
        const { tasks, totalCount } = await userRepository.tasksByProject(projectId, skip, limit, status, range, minExtensions);
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
        { parentIds, roomIds, roomLogIds },
        minExtensions
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
      const editsContent =
        data.description !== undefined ||
        data.priority !== undefined ||
        data.start_date !== undefined ||
        data.due_date !== undefined ||
        data.tags !== undefined ||
        data.sequential !== undefined;
      if (status === undefined && group_id === undefined && !editsContent) {
        throw new Error(
          "Nothing to update: send status, group_id or an edited field"
        );
      }
      const task = (await userRepository.findTask(id)) as TaskWithDailyLog;
      if (!task) throw new Error("Task not found");
      if (task.isLocked) {
        throw new Error("Daily log is locked. Cannot update task status.");
      }

      // Every content field validated BEFORE the transaction opens, so a bad
      // priority on an edit that also moves the lane leaves the lane where it
      // was rather than half-applying.
      const content: {
        description?: string;
        priority?: string;
        start_date?: string | null;
        due_date?: string | null;
        tags?: string[];
        sequential?: boolean;
      } = {};

      if (data.description !== undefined) {
        const description = String(data.description).trim();
        // No clearing this one. A card with an empty title is unreadable on
        // the board and there is nothing else on the row to identify it by.
        if (!description) {
          throw new TaskValidationError("description cannot be empty");
        }
        content.description = description;
      }
      if (data.priority !== undefined) {
        const priority = normalizePriority(data.priority as string);
        if (priority === undefined) {
          throw new TaskValidationError("priority cannot be empty");
        }
        content.priority = priority;
      }
      const startDate = parseEditableDate(data.start_date, "start_date");
      if (startDate !== undefined) content.start_date = startDate;
      const dueDate = parseEditableDate(data.due_date, "due_date");
      if (dueDate !== undefined) content.due_date = dueDate;
      if (data.tags !== undefined) content.tags = normalizeTags(data.tags);
      if (data.sequential !== undefined) {
        // The flag lives on the parent and orders its children. A subtask has
        // none, so accepting it there would store a value nothing ever reads
        // and leave the client believing it had set an ordering.
        if ((task as any).parent_id) {
          throw new TaskValidationError(
            "sequential applies to a main task, not a subtask"
          );
        }
        content.sequential = coerceBoolean(data.sequential);
      }

      // Both halves of the range, whichever of them this request supplies:
      // an edit that moves only the due date still has to land after the
      // start date already on the row.
      const effectiveStart =
        content.start_date !== undefined
          ? content.start_date
          : ((task as any).start_date ?? null);
      const effectiveDue =
        content.due_date !== undefined
          ? content.due_date
          : ((task as any).due_date ?? null);
      if (
        effectiveStart &&
        effectiveDue &&
        String(effectiveDue) < String(effectiveStart)
      ) {
        throw new TaskValidationError("due_date cannot be before start_date");
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

      // One transaction around both order checks and the task's own update, so
      // each check is read against the same snapshot as the write it guards.
      const sequelize = Database.getSequelize();
      const { updated, parent } = await sequelize.transaction(
        async (t: Transaction) => {
          // Section 4(c): a MAIN task cannot be completed while its own
          // subtasks are open.
          //
          // The opposite direction from the roll-up that used to sit at the
          // bottom of this transaction, and the reason removing it leaves no
          // hole: the roll-up let a CHILD finish the parent, which is wrong.
          // This stops the parent's OWNER finishing it early, which is the
          // check that actually belongs here — Complete is offered whether
          // children are open or not, so nothing else stands between a task
          // badged 1/2 and a completed status.
          //
          // Inside the transaction for the same reason 4(a) is: without it,
          // completing the parent and starting the last subtask in the same
          // moment both pass.
          if (!parentId && statusSlug(effectiveStatus) === "completed") {
            const children = await userRepository.findChildren(id, t);
            const open = children.filter(
              (childRow: any) => statusSlug(childRow.status) !== "completed"
            );
            if (open.length) {
              // Written to be shown to the user as-is.
              throw new SubtaskOpenError(
                `Can't complete this task — ${open.length} subtask${
                  open.length === 1 ? "" : "s"
                } still to finish`
              );
            }
          }

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

          // Skipped entirely on a content-only edit: updateTaskLane throws on
          // an empty change set, and running it would stamp the clock for a
          // status nobody sent.
          let child = task as Task;
          if (effectiveStatus !== undefined || group_id !== undefined) {
            child = await userRepository.updateTaskLane(
              task,
              { status: effectiveStatus, group_id },
              t
            );
          }

          // Second save, same transaction, disjoint column list — see
          // updateTaskFields on why the two are not merged.
          child = await userRepository.updateTaskFields(child, content, t);

          // NO parent roll-up. A task and its subtasks are separate units of
          // work with separate clocks: finishing the last child used to write
          // the parent's status, end_time and total_seconds, which recorded
          // time against an owner who never touched it and marked work
          // accepted that nobody had accepted. The parent is completed by
          // whoever owns it, from its own control.
          //
          // The parent is still READ back below — a child's move changes its
          // siblings' is_blocked/blocked_by, and that recomputation is what
          // data.parent is for. Read, never written.
          const parentRow = parentId
            ? await userRepository.findTaskRaw(parentId, t)
            : null;

          return { updated: child, parent: parentRow };
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
      // is the whole card with every subtask re-decorated, which is what the
      // board needs after a child moves: the siblings' is_blocked/blocked_by
      // are recomputed from the new statuses. The parent's OWN status, clock
      // and times are untouched by any of this — see the transaction above.
      // Null for a top-level task.
      //
      // Additive: everything the response carried before is still on the
      // object at the same key.
      const parentView = parent
        ? await userRepository.findTaskWithSubtasks((parent as any).id)
        : null;

      // A main task is re-read WITH its children and fully decorated, so an
      // edit that renames the card or flips `sequential` hands back the same
      // shape /task-list returns and the row can be replaced outright. A
      // subtask is not: that read does not fetch children, and decorateTask
      // would report `subtasks: []`, which a client holding a real list would
      // read as "all deleted". It gets capComments instead, which still keeps
      // the comment array from arriving uncapped on every status click.
      const selfView = parentId
        ? null
        : await userRepository.findTaskWithSubtasks((updated as any).id);

      const authors = await commentAuthorsFor(
        [updated, parentView, selfView].filter(Boolean) as any[]
      );

      return {
        ...(selfView
          ? decorateTask(selfView, authors)
          : capComments(updated, authors)),
        parent: parentView ? decorateTask(parentView, authors) : null,
      };
    } catch (error) {
      console.error("Error in updateStatus:", error);
      throw error;
    }
  }

  // POST /role-user/task/extend — push a deadline, on the record.
  //
  // Not a PATCH of due_date. The date is only half of it: the row this writes
  // is what makes "extended twice, 21st -> 25th -> 30th, because QA slipped"
  // recoverable, and a silent edit of the column loses every part of that but
  // the final date.
  //
  // Works on a subtask as well as a main task — a subtask has its own deadline,
  // so it has its own log.
  public async extendTask(data: {
    task_id: string;
    due_date: string;
    reason: string;
    user?: { id?: string; role?: string };
  }) {
    try {
      const task_id = String(data.task_id ?? "").trim();
      if (!task_id) throw new TaskValidationError("task_id is required");

      // The whole point of the feature. Rejected before anything else so a
      // client cannot get the date moved and then fail on the why.
      const reason = String(data.reason ?? "").trim();
      if (!reason) {
        throw new TaskValidationError("reason is required to extend a task");
      }

      const parsed = parseEditableDate(data.due_date, "due_date");
      if (!parsed) {
        throw new TaskValidationError("due_date is required");
      }
      const new_due_date = parsed;

      const task = (await userRepository.findTask(task_id)) as TaskWithDailyLog;
      if (!task) throw new Error("Task not found");

      const viewerId = data.user?.id;
      if (!viewerId) throw new Error("User not authenticated");

      // The assignee, the creator, an AM over either of them, or SP. The same
      // set that may delete the task — extending is a change to somebody's
      // committed date, so "can see it" is not enough.
      const log: any =
        (task as any).dailyLog ?? (task as any).dataValues?.dailyLog;
      const owners = new Set<string>();
      if (log?.created_by) owners.add(log.created_by);
      if (log?.assigned_to) owners.add(log.assigned_to);

      let allowed = data.user?.role === "SP" || owners.has(viewerId);
      if (!allowed && data.user?.role === "AM") {
        for (const owner of owners) {
          if (await taskGroupRepository.isBoardManagedBy(viewerId, owner)) {
            allowed = true;
            break;
          }
        }
      }
      if (!allowed) {
        throw new TaskForbiddenError("Not authorized to extend this task");
      }

      if (task.isLocked) {
        throw new Error("Task is locked. Cannot extend.");
      }
      if (log?.locked) {
        throw new Error("Daily log is locked. Cannot extend task.");
      }

      // DATEONLY comes back as "YYYY-MM-DD", so a string compare is a date
      // compare — no timezone to get wrong.
      const previous_due_date: string | null =
        ((task as any).due_date as string | null) ?? null;
      if (previous_due_date && String(new_due_date) <= String(previous_due_date)) {
        // Pulling a deadline IN is not an extension. It is a legitimate edit,
        // it just belongs on PATCH /updateTask where it is not recorded as a
        // slip — calling it one would inflate the count this table exists to
        // report.
        throw new TaskValidationError(
          "New due date must be after the current one. To bring a deadline forward, edit the task instead"
        );
      }

      const sequelize = Database.getSequelize();
      await sequelize.transaction(async (t: Transaction) =>
        userRepository.createTaskExtension(
          task,
          { previous_due_date, new_due_date, reason, extended_by: viewerId },
          t
        )
      );

      // Same read model /task-list returns, so the panel can redraw the card
      // and its new log entry from this response alone. A subtask re-reads
      // through its parent, which is the card the board actually draws.
      const parentId: string | null = (task as any).parent_id ?? null;
      const view = await userRepository.findTaskWithSubtasks(parentId ?? task_id);
      if (!view) return task;
      const authors = await commentAuthorsFor([view]);
      return decorateTask(view, authors);
    } catch (error) {
      console.error("Error in extendTask:", error);
      throw error;
    }
  }

  // DELETE /role-user/task?id=<taskId>
  //
  // A MAIN task takes its subtasks with it — a subtask cannot outlive the task
  // it breaks down; there would be nothing to nest it under. A SUBTASK deletes
  // alone, leaving the parent and its siblings where they are.
  //
  // Irreversible: the row is gone, and with it the time banked on it, which
  // reports read straight from the tasks table. If that history has to survive
  // a delete this needs a `deleted_at` column instead, which is a migration and
  // a filter on every read.
  public async deleteTask(data: {
    id: string;
    user?: { id?: string; role?: string };
  }) {
    try {
      const id = String(data.id ?? "").trim();
      if (!id) throw new TaskValidationError("Task id is required");

      const task = (await userRepository.findTask(id)) as TaskWithDailyLog;
      if (!task) throw new Error("Task not found");

      const viewerId = data.user?.id;
      if (!viewerId) throw new Error("User not authenticated");

      // Deliberately NARROWER than TaskAccessService.canRead, which lets any
      // active member of a room read a task. Reading is not deleting: on a
      // room board that rule would let every member destroy someone else's
      // work. Delete is for the people who own the task —
      //
      //   SP, the task's creator, the person it is assigned to, an AM over
      //   that person's board, and for a subtask the parent's creator too,
      //
      // because the parent's owner is who arranges its breakdown.
      const log: any = (task as any).dailyLog ?? (task as any).dataValues?.dailyLog;
      const parentId: string | null = (task as any).parent_id ?? null;

      const owners = new Set<string>();
      if (log?.created_by) owners.add(log.created_by);
      if (log?.assigned_to) owners.add(log.assigned_to);

      let parent: any = null;
      if (parentId) {
        parent = await userRepository.findTask(parentId);
        const parentLog: any =
          parent?.dailyLog ?? parent?.dataValues?.dailyLog;
        if (parentLog?.created_by) owners.add(parentLog.created_by);
      }

      let allowed =
        data.user?.role === "SP" || owners.has(viewerId);

      if (!allowed && data.user?.role === "AM") {
        for (const owner of owners) {
          if (await taskGroupRepository.isBoardManagedBy(viewerId, owner)) {
            allowed = true;
            break;
          }
        }
      }
      if (!allowed) {
        throw new TaskForbiddenError("Not authorized to delete this task");
      }

      // Both locks, same as every other write on a task.
      if (task.isLocked) {
        throw new Error("Task is locked. Cannot delete.");
      }
      if (log?.locked) {
        throw new Error("Daily log is locked. Cannot delete task.");
      }

      const sequelize = Database.getSequelize();
      const removed = await sequelize.transaction(async (t: Transaction) =>
        userRepository.deleteTaskCascade(task, t)
      );

      // A deleted SUBTASK hands back its parent, re-read after the commit: the
      // siblings' is_blocked/blocked_by shift when one of them disappears, the
      // same reason updateStatus returns it. A deleted main task has no parent
      // to return.
      const parentView = parentId
        ? await userRepository.findTaskWithSubtasks(parentId)
        : null;
      const authors = parentView ? await commentAuthorsFor([parentView]) : new Map();

      return {
        id: removed.id,
        parent_id: parentId,
        // The subtasks that went with it. Empty for a deleted subtask.
        deleted_subtask_ids: removed.subtask_ids,
        deleted_subtasks: removed.subtask_ids.length,
        parent: parentView ? decorateTask(parentView, authors as any) : null,
      };
    } catch (error) {
      console.error("Error in deleteTask:", error);
      throw error;
    }
  }

  // POST /role-user/task/subtask — one subtask onto an existing parent, for
  // the list view's "add subtask" row.
  //
  // Not POST /task with a parent_id. That path takes project_id, room_id and
  // position from the client and so leaves the child on position 0 (above
  // every sibling, and first to run on a sequential parent) and outside its
  // parent's room whenever the client forgets to resend them. Here all three
  // come off the parent row, which is the only place they can be right.
  public async addSubtask(data: SubtaskCreateInput) {
    try {
      const parent_id = String(data.parent_id ?? "").trim();
      if (!parent_id) {
        throw new TaskValidationError("parent_id is required");
      }
      const description = String(data.description ?? "").trim();
      if (!description) {
        throw new TaskValidationError("description is required");
      }

      const parent = (await userRepository.findTask(
        parent_id
      )) as TaskWithDailyLog;
      if (!parent) throw new Error("Parent task not found");
      // One level only. The board draws a parent and its children; a
      // grandchild would be stored and then never rendered anywhere.
      if ((parent as any).parent_id) {
        throw new TaskValidationError("A subtask cannot have subtasks");
      }
      if (parent.isLocked) {
        throw new Error("Task is locked. Cannot add a subtask.");
      }

      const parentLog: any =
        (parent as any).dailyLog ?? (parent as any).dataValues?.dailyLog;
      if (parentLog?.locked) {
        throw new Error("Daily log is locked. Cannot add new task.");
      }

      const priority =
        normalizePriority(data.priority) ??
        ((parent as any).priority as string | undefined);
      const start_date = parseEditableDate(data.start_date, "start_date");
      const due_date = parseEditableDate(data.due_date, "due_date");
      if (start_date && due_date && String(due_date) < String(start_date)) {
        throw new TaskValidationError("due_date cannot be before start_date");
      }

      const project_id: string | null = (parent as any).project_id ?? null;
      // Inherited, never taken from the client: a subtask is the same piece of
      // work as its parent, so it belongs on the same room board. This is the
      // rule the subtasks[] array already follows on create.
      const room_id: string | null = (parent as any).room_id ?? null;

      // The same membership rule POST /task applies to subtasks[].assigned_to:
      // inside a room, only an ACTIVE member can be handed work; outside one,
      // the user merely has to exist. Checked before anything is written.
      const assignee = data.assigned_to;
      if (assignee) {
        if (room_id) {
          const allowed = await workspaceRepository.activeRoomMemberIds(room_id);
          if (!allowed.includes(assignee)) {
            throw new SubtaskValidationError(
              `assigned_to (${assignee}) is not a member of room ${room_id}`
            );
          }
        } else {
          const missing = await workspaceRepository.missingUserIds([assignee]);
          if (missing.includes(assignee)) {
            throw new SubtaskValidationError(
              `assigned_to (${assignee}) is not a known user`
            );
          }
        }
      }

      const created_by: string | undefined =
        data.created_by ?? parentLog?.created_by;

      // No assignee, or the parent's own owner: the subtask goes straight into
      // the parent's log. Anyone else gets their own log for today, because
      // assignment IS the log's (created_by, assigned_to) pair — there is no
      // assignee column on tasks to set instead.
      let subLog: any = { id: (parent as any).daily_log_id };
      if (assignee && assignee !== parentLog?.assigned_to) {
        const dailytaskTime = new Date().toISOString().split("T")[0];
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
            project_id ?? undefined
          );
        }
        if (log?.dataValues?.locked) {
          throw new Error("Daily log is locked. Cannot add new task.");
        }
        subLog = log;
      }

      // Last by default. Without this the row takes the column's 0 default and
      // sorts above every existing child — and on a sequential parent it
      // becomes the one subtask allowed to start, ahead of work already
      // underway. An explicit position still wins, for a client that inserts
      // in the middle.
      const position =
        data.position !== undefined && data.position !== null
          ? Number(data.position)
          : ((await userRepository.maxChildPosition(parent_id)) ?? 0) + 1;

      const created = await userRepository.createNewTask({
        dailyTaskLog: subLog,
        project_id: project_id ?? undefined,
        description,
        priority: priority as string,
        start_date: start_date ?? undefined,
        due_date: due_date ?? undefined,
        status: "yet_to_start",
        parent_id,
        room_id,
        // Falls back to the parent's tags, matching what subtasks[] does on
        // create: a subtask with no tags of its own inherits the parent's.
        tags: data.tags !== undefined ? normalizeTags(data.tags) : (parent as any).tags,
        position,
      });

      // Section 6, event 1: "a subtask is assigned to you". After the write,
      // so a notification failure cannot leave a half-created subtask behind.
      if (assignee) {
        const [actor] = created_by
          ? await userRepository.findUsersLite([created_by])
          : [];
        await taskNotifications.subtaskAssigned({
          assignee_id: assignee,
          actor_id: created_by,
          actor_name: (actor as any)?.fullName ?? null,
          subtask_description: description,
          parent_description: (parent as any).description,
          parent_id,
          position,
          sequential: (parent as any).sequential === true,
        });
      }

      // The decorated PARENT, not the new child: the list view redraws the
      // whole expanded row, and the child on its own would not carry the
      // siblings' new order or the parent's rolled-up status.
      const parentView = await userRepository.findTaskWithSubtasks(parent_id);
      if (!parentView) return created;
      const authors = await commentAuthorsFor([parentView]);
      return decorateTask(parentView, authors);
    } catch (error) {
      console.error("Error in addSubtask:", error);
      throw error;
    }
  }
}
