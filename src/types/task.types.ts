import { Task } from "../connection/models/tasks";

export interface TaskStatusUpdate {
  id: string;
  // Both optional, and `undefined` means "leave unchanged". JSON has no
  // undefined, so an explicit `"group_id": null` from a status-lane drop is
  // distinguishable from a group drop that deliberately sends no status.
  status?: string;
  group_id?: string | null;
  DailyTaskLog?: any;

  // ── Content edits ─────────────────────────────────────────────────────────
  //
  // The edit modal's fields, on the same PATCH as the board's drag-and-drop.
  // One route rather than two because both need the identical daily-log-lock
  // check and both return the same read model; splitting them would duplicate
  // the guard and let a client PATCH a locked log through the other door.
  //
  // Same `undefined` rule as above: absent means "leave unchanged", so the
  // client sends only what the user actually touched. `start_date: null` and
  // `due_date: null` clear the date; `description` cannot be cleared, because
  // a task with no description is unreadable on the board.
  description?: string;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  tags?: unknown;
  // Parent-only. Rejected on a row that has a parent_id — a subtask has no
  // children to order.
  sequential?: unknown;
}

// POST /role-user/task/subtask — add one subtask to an existing parent.
//
// Deliberately NOT the create payload: everything derivable from the parent
// (project_id, room_id, and position when omitted) is read off the parent row
// instead of being trusted from the client. POST /task with a parent_id skips
// all three, which is why that path leaves the child on position 0 and outside
// its parent's room.
export interface SubtaskCreateInput {
  parent_id: string;
  description: string;
  // Omitted means the subtask lands in the parent's own daily log, i.e. it
  // belongs to whoever owns the parent. Given, it gets that person's log for
  // today — assignment lives on the log, not on tasks.
  assigned_to?: string;
  // Who is performing the action. Falls back to the parent log's created_by,
  // so a client that does not send it still produces a correctly-owned log.
  created_by?: string;
  priority?: string;
  start_date?: string;
  due_date?: string;
  tags?: unknown;
  // Omitted means "last": MAX(position) + 1 across the existing children.
  position?: number;
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
