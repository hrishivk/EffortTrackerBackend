import { Task } from "../connection/models/tasks";
import { UserRepository } from "../repositories/user.repository";
import { WorkspaceRepository } from "../repositories/workspace.repository";
import { TaskGroupRepository } from "../repositories/task-group.repository";

const userRepository = new UserRepository();
const workspaceRepository = new WorkspaceRepository();
const taskGroupRepository = new TaskGroupRepository();

// Who may read one task, and who is "on" it.
//
// This is section 3's read rule expressed for a SINGLE task, so the comment
// routes enforce exactly what /task-list returns rather than a second,
// hand-rolled approximation of it. "Who may comment: anyone who can read the
// task" is then literally true.
//
// The rule:
//   - the task's assignee, or the assignee of any of its subtasks
//   - whoever created it
//   - any ACTIVE member of the room named by room_id, when it has one
//   - SP, who sees every board, and an AM over a participant's board - both
//     already true of /task-list via findDailyLogs, so leaving them out here
//     would let someone read a task in the list and get a 403 commenting on it
//
// Assignment lives on the daily log (created_by, assigned_to), not on a column
// of tasks, which is what lets one parent's children belong to three people.

export interface TaskParticipants {
  // The main task. For a comment on a subtask this is the PARENT: a comment on
  // one subtask still concerns everyone working on the shared task.
  root: Task;
  children: Task[];
  // Everyone assigned to the root or to any of its subtasks, plus their
  // creators. De-duplicated.
  participantIds: string[];
  room_id: string | null;
}

const logOf = (task: any): any => task?.dailyLog ?? task?.dataValues?.dailyLog;

export class TaskAccessService {
  // Resolves a task to its shared-task context. Returns null when the task, or
  // the parent it points at, no longer exists.
  public async participantsFor(task: Task): Promise<TaskParticipants | null> {
    const parentId = (task as any).parent_id;
    const root = parentId
      ? await userRepository.findTaskWithSubtasks(parentId)
      : await userRepository.findTaskWithSubtasks((task as any).id);
    if (!root) return null;

    const children: Task[] = ((root as any).subtasks ?? []) as Task[];

    const ids = new Set<string>();
    const collect = (t: any) => {
      const log = logOf(t);
      if (log?.assigned_to) ids.add(log.assigned_to);
      if (log?.created_by) ids.add(log.created_by);
    };
    collect(root);
    for (const child of children) collect(child);

    return {
      root,
      children,
      participantIds: [...ids],
      room_id: (root as any).room_id ?? (task as any).room_id ?? null,
    };
  }

  // The authorization decision of section 3, taken as the frontend suggested:
  // a task with a room_id is readable by every active member of that room;
  // a task without one keeps the stricter participant rule.
  //
  // Room membership is checked LAST because it is the only branch that costs a
  // query, and on a task the caller is actually working on the participant
  // check has already answered.
  public async canRead(
    viewer: { id: string; role?: string },
    context: TaskParticipants
  ): Promise<boolean> {
    if (!viewer?.id) return false;
    if (viewer.role === "SP") return true;
    if (context.participantIds.includes(viewer.id)) return true;

    if (context.room_id) {
      const members = await workspaceRepository.activeRoomMemberIds(
        context.room_id
      );
      if (members.includes(viewer.id)) return true;
    }

    if (viewer.role === "AM") {
      for (const participant of context.participantIds) {
        if (await taskGroupRepository.isBoardManagedBy(viewer.id, participant)) {
          return true;
        }
      }
    }

    return false;
  }

  // Deleting a comment is allowed for its author OR for whoever created the
  // task it sits on - the task's creator moderates its thread. "Created the
  // task" is the daily log's created_by, the same field section 3 reads for
  // "they created it".
  public isTaskCreator(task: Task, user_id: string): boolean {
    const log = logOf(task);
    return !!log?.created_by && log.created_by === user_id;
  }
}
