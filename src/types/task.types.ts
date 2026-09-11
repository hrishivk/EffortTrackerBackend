import { Task } from "../connection/models/tasks";

export interface TaskStatusUpdate {
  id: string;
  // Both optional, and `undefined` means "leave unchanged". JSON has no
  // undefined, so an explicit `"group_id": null` from a status-lane drop is
  // distinguishable from a group drop that deliberately sends no status.
  status?: string;
  group_id?: string | null;
  DailyTaskLog?: any;
}
export interface TaskWithDailyLog extends Task {
  isLocked: boolean;
}
export interface TaskData {
  date: string | undefined;
  id: string | undefined;
}
export type TaskStatus = "yet_to_start" | "in_progress" | "completed" | "blocked";

export interface TaskGroupInput {
  user_id: string;
  name: string;
  color?: string | null;
  position?: number;
}

export interface TaskGroupPatch {
  name?: string;
  color?: string | null;
  position?: number;
}

// ── Room shared tasks ───────────────────────────────────────────────────────

// One element of tasks.comments. Stored on the task row (or the subtask row —
// a subtask is a row in the same table), never as its own task with a
// `type: 'comment'` flag: such a row would be counted as a subtask, drawn on
// the board as a card, and dragged into the sequential-order and
// parent-rollup rules.
export interface TaskComment {
  id: string;
  user_id: string;
  // Snapshot of the author's name at write time. There is no FK on user_id, so
  // a deleted user would otherwise leave a comment with nobody's name on it.
  // Reads still resolve the LIVE name for a user who still exists, so a rename
  // shows through; this is only the fallback. See docs/room-shared-tasks-api.md.
  user_name?: string | null;
  body: string;
  created_at: string;
  // Stays null until edited, so the client can show "edited".
  updated_at: string | null;
}

export const MAX_COMMENT_LENGTH = 2000;

// The newest N comments /task-list ships per task. comment_count is always the
// TRUE length, so `comment_count > comments.length` is how the client knows
// there are older ones. No "load older" route until it actually bites.
export const COMMENT_PAGE_SIZE = 50;

export interface CommentCreateInput {
  task_id: string;
  body: string;
  user_id: string;
}

export interface CommentUpdateInput {
  task_id: string;
  comment_id: string;
  body: string;
  user_id: string;
}

export interface CommentDeleteInput {
  task_id: string;
  comment_id: string;
  user_id: string;
}
