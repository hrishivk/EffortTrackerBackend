import {
  TaskCommentRepository,
  normalizeCommentBody,
} from "../repositories/task-comment.repository";
import { UserRepository } from "../repositories/user.repository";
import { TaskAccessService } from "./task-access.service";
import { TaskNotificationService } from "./task-notification.service";
import {
  CommentCreateInput,
  CommentDeleteInput,
  CommentUpdateInput,
  MAX_COMMENT_LENGTH,
  TaskComment,
} from "../types/task.types";

const commentRepository = new TaskCommentRepository();
const userRepository = new UserRepository();
const taskAccess = new TaskAccessService();
const taskNotifications = new TaskNotificationService();

// Error strings the controller maps to status codes. Kept as constants so the
// map cannot drift from the throw site.
export const COMMENT_ERRORS = {
  taskNotFound: "Task not found",
  commentNotFound: "Comment not found",
  notAuthorized: "Not authorized to read this task",
  notAuthor: "Only the author can edit this comment",
  notDeletable: "Only the author or the task creator can delete this comment",
  emptyBody: "Comment body is required",
  missingIds: "task_id and comment_id are required",
};

// There is no GET route on purpose: comments come back inside /task-list. These
// three writes exist rather than letting the client PATCH the comments array
// itself, because a whole-array write from a browser both loses comments that
// landed concurrently and lets anyone rewrite someone else's.

export class TaskCommentService {
  public async addComment(
    input: CommentCreateInput & { role?: string }
  ): Promise<TaskComment> {
    const body = normalizeCommentBody(input.body);
    if (!body) throw new Error(COMMENT_ERRORS.emptyBody);

    const task = await commentRepository.findTask(input.task_id);
    if (!task) throw new Error(COMMENT_ERRORS.taskNotFound);

    const context = await taskAccess.participantsFor(task);
    if (!context) throw new Error(COMMENT_ERRORS.taskNotFound);
    const allowed = await taskAccess.canRead(
      { id: input.user_id, role: input.role },
      context
    );
    if (!allowed) throw new Error(COMMENT_ERRORS.notAuthorized);

    const [author] = await userRepository.findUsersLite([input.user_id]);

    const comment = await commentRepository.append(
      input.task_id,
      { id: input.user_id, fullName: (author as any)?.fullName ?? null },
      body
    );
    if (!comment) throw new Error(COMMENT_ERRORS.taskNotFound);

    // After the write, and deliberately not awaited into the failure path -
    // TaskNotificationService swallows its own errors, so a notification
    // problem cannot lose a comment that is already committed.
    await taskNotifications.commentPosted({
      task,
      root: context.root,
      participant_ids: context.participantIds,
      author_id: input.user_id,
      author_name: (author as any)?.fullName ?? null,
      body,
    });

    return comment;
  }

  // Author only. The database statement enforces that too - this pre-read only
  // decides between 404 and 403.
  public async editComment(
    input: CommentUpdateInput & { role?: string }
  ): Promise<TaskComment> {
    if (!input.task_id || !input.comment_id) {
      throw new Error(COMMENT_ERRORS.missingIds);
    }
    const body = normalizeCommentBody(input.body);
    if (!body) throw new Error(COMMENT_ERRORS.emptyBody);

    const task = await commentRepository.findTask(input.task_id);
    if (!task) throw new Error(COMMENT_ERRORS.taskNotFound);

    const existing = await commentRepository.findComment(
      input.task_id,
      input.comment_id
    );
    if (!existing) throw new Error(COMMENT_ERRORS.commentNotFound);
    if (existing.user_id !== input.user_id) {
      throw new Error(COMMENT_ERRORS.notAuthor);
    }

    const updated = await commentRepository.edit(
      input.task_id,
      input.comment_id,
      input.user_id,
      body
    );
    // Zero rows here means the comment was deleted between the read above and
    // the write - the same answer as if it had never been there.
    if (!updated) throw new Error(COMMENT_ERRORS.commentNotFound);
    return updated;
  }

  // Author, or whoever created the task.
  public async deleteComment(
    input: CommentDeleteInput & { role?: string }
  ): Promise<{ task_id: string; comment_id: string; deleted: true }> {
    if (!input.task_id || !input.comment_id) {
      throw new Error(COMMENT_ERRORS.missingIds);
    }

    const task = await commentRepository.findTask(input.task_id);
    if (!task) throw new Error(COMMENT_ERRORS.taskNotFound);

    const existing = await commentRepository.findComment(
      input.task_id,
      input.comment_id
    );
    if (!existing) throw new Error(COMMENT_ERRORS.commentNotFound);

    const isCreator = taskAccess.isTaskCreator(task, input.user_id);
    if (existing.user_id !== input.user_id && !isCreator) {
      throw new Error(COMMENT_ERRORS.notDeletable);
    }

    const removed = await commentRepository.remove(
      input.task_id,
      input.comment_id,
      input.user_id,
      isCreator
    );
    if (!removed) throw new Error(COMMENT_ERRORS.commentNotFound);

    return {
      task_id: input.task_id,
      comment_id: input.comment_id,
      deleted: true,
    };
  }
}

export { MAX_COMMENT_LENGTH };
