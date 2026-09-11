import { NotificationRepository } from "../repositories/notification.repository";
import { UserRepository } from "../repositories/user.repository";
import { Task } from "../connection/models/tasks";

const notificationRepo = new NotificationRepository();
const userRepository = new UserRepository();

// The four events section 6 asks for, in one place.
//
// Every method here is FIRE AND FORGET at the call site: a notification that
// fails must never fail the write that earned it. Losing a bell is annoying;
// rolling back a completed subtask because the notifications table hiccuped is
// worse. Each method therefore swallows its own errors and logs them.
//
// Notification.type is VARCHAR(30), so every type string below is kept short.

const notify = async (label: string, work: () => Promise<unknown>) => {
  try {
    await work();
  } catch (error: any) {
    console.error(`Notification (${label}) failed:`, error?.message ?? error);
  }
};

// Mentions are parsed out of the comment body. The write path stores the body
// verbatim, so this is a read of what the author typed: an @ immediately
// followed by a user id.
//
// User ids are 15 alphanumeric characters (generateAlphaNumericValue), so the
// pattern is deliberately loose - 3 to 30 of the id alphabet - and every
// candidate is then checked against the users table. That way a plain "@here"
// or an email in the body produces no notification rather than a bogus one,
// and we never have to keep this regex in step with the id format.
const MENTION_PATTERN = /@([A-Za-z0-9_]{3,30})/g;

export const parseMentionIds = (body: string): string[] => {
  const ids = new Set<string>();
  for (const match of String(body ?? "").matchAll(MENTION_PATTERN)) {
    ids.add(match[1]);
  }
  return [...ids];
};

export class TaskNotificationService {
  // "A subtask is assigned to you" -> the subtask's assignee.
  //
  // Skipped when the assignee is the person who created the task: nobody needs
  // telling about work they just gave themselves.
  public async subtaskAssigned(data: {
    assignee_id: string;
    actor_id?: string;
    actor_name?: string | null;
    subtask_description: string;
    parent_description: string;
    parent_id: string;
    position?: number;
    sequential?: boolean;
  }) {
    if (!data.assignee_id || data.assignee_id === data.actor_id) return;
    await notify("subtask_assigned", () =>
      notificationRepo.create({
        user_id: data.assignee_id,
        type: "task_subtask_assigned",
        title: "New Subtask Assigned",
        message: `${data.actor_name || "Someone"} assigned you "${
          data.subtask_description
        }" on "${data.parent_description}"${
          data.sequential && data.position
            ? ` (step ${data.position}, runs in order)`
            : ""
        }`,
        // The PARENT, not the subtask: the subtask has no card of its own, so
        // this is the id a click has to open.
        reference_id: data.parent_id,
      })
    );
  }

  // "The subtask before yours is completed - your turn to start."
  //
  // This is the important one. Without it the next person has to keep polling
  // the board to find out their turn has come.
  //
  // Raised only for the ONE subtask that just became startable: the next
  // incomplete child in position order, on a sequential parent. If that child
  // is still blocked by an earlier sibling (someone completed step 3 while step
  // 1 is outstanding) nobody is told, because nobody's turn actually came.
  public async subtaskUnblocked(data: {
    parent: Task;
    children: Task[];
    completed_child: Task;
  }) {
    const parent: any = data.parent;
    if (!parent || parent.sequential !== true) return;

    const ordered = [...data.children].sort(
      (a: any, b: any) => Number(a.position ?? 0) - Number(b.position ?? 0)
    );
    const completedPos = Number((data.completed_child as any).position ?? 0);

    // The next child after the one that just finished, in position order.
    const next: any = ordered.find(
      (c: any) =>
        Number(c.position ?? 0) > completedPos &&
        String(c.status ?? "").toLowerCase().trim() !== "completed"
    );
    if (!next) return;

    // Their turn has only come if nothing earlier is still outstanding.
    const stillBlocked = ordered.some(
      (c: any) =>
        Number(c.position ?? 0) < Number(next.position ?? 0) &&
        String(c.status ?? "").toLowerCase().trim() !== "completed"
    );
    if (stillBlocked) return;

    const assignee =
      next.dailyLog?.assigned_to ?? next.dailyLog?.dataValues?.assigned_to;
    if (!assignee) return;

    await notify("subtask_unblocked", () =>
      notificationRepo.create({
        user_id: assignee,
        type: "task_subtask_unblocked",
        title: "Your Turn To Start",
        message: `"${
          (data.completed_child as any).description
        }" is completed. You can now start "${next.description}" on "${
          parent.description
        }"`,
        reference_id: parent.id,
      })
    );
  }

  // "Someone comments on a task you are on" -> everyone assigned to the task or
  // any of its subtasks, except the author. Plus, separately, anyone
  // @-mentioned in the body.
  //
  // The two are raised as different types so a mention can be styled
  // differently, and a mentioned participant gets the mention rather than both:
  // being named in a comment is the stronger signal, and two bells for one
  // comment is noise.
  public async commentPosted(data: {
    task: Task;
    // The task the comment landed on, and its parent when that task is a
    // subtask - a comment on a subtask still concerns everyone on the parent.
    root: Task;
    participant_ids: string[];
    author_id: string;
    author_name?: string | null;
    body: string;
  }) {
    const rootId = (data.root as any)?.id ?? (data.task as any)?.id;
    const label = (data.task as any)?.description ?? "a task";

    const mentioned = await this.resolveMentions(
      data.body,
      data.participant_ids,
      data.author_id
    );
    const mentionedSet = new Set(mentioned);

    const recipients = data.participant_ids.filter(
      (id) => id && id !== data.author_id && !mentionedSet.has(id)
    );

    const excerpt =
      data.body.length > 140 ? `${data.body.slice(0, 140)}...` : data.body;

    if (recipients.length) {
      await notify("comment_posted", () =>
        notificationRepo.createMany(recipients, {
          type: "task_comment",
          title: "New Comment",
          message: `${data.author_name || "Someone"} commented on "${label}": ${excerpt}`,
          reference_id: rootId,
        })
      );
    }

    if (mentioned.length) {
      await notify("comment_mention", () =>
        notificationRepo.createMany(mentioned, {
          type: "task_comment_mention",
          title: "You Were Mentioned",
          message: `${data.author_name || "Someone"} mentioned you on "${label}": ${excerpt}`,
          reference_id: rootId,
        })
      );
    }
  }

  // An @-token only earns a notification when it names a REAL user who can
  // already read this task. Otherwise @-mentioning an id would be a way to
  // push a notification, carrying an excerpt of the comment, at someone with
  // no access to the task it was written on.
  private async resolveMentions(
    body: string,
    participant_ids: string[],
    author_id: string
  ): Promise<string[]> {
    const candidates = parseMentionIds(body).filter(
      (id) => id !== author_id && participant_ids.includes(id)
    );
    if (!candidates.length) return [];
    const users = await userRepository.findUsersLite(candidates);
    return users.map((u: any) => u.id);
  }
}
