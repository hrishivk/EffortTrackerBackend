import { COMMENT_PAGE_SIZE, TaskComment } from "../types/task.types";

// The read model for a board card, shared by POST /task and GET /task-list so
// the two cannot drift.
//
// Everything here is COMPUTED AT READ TIME. `is_blocked` and `blocked_by` in
// particular are deliberately not columns: they are a function of the
// siblings' statuses, so a stored copy would be stale the moment somebody
// else's subtask completed, and there would be two sources of truth for the
// rule that section 4 enforces on write.
//
// Nothing here removes or renames an existing field. Every property it sets is
// additive, so screens written against the old shape keep working.

export interface UserLite {
  id: string;
  fullName?: string | null;
  email?: string | null;
}

const REAL_STATUSES = new Set([
  "yet_to_start",
  "in_progress",
  "completed",
  "blocked",
]);

const slug = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const toPlain = (row: any): any =>
  row && typeof row.toJSON === "function" ? row.toJSON() : { ...(row ?? {}) };

// Assignment is not a column on tasks. It lives on the task's daily log
// (created_by, assigned_to), which is exactly what lets the three children of
// one parent sit in three different people's logs and so belong to three
// different people.
//
// The client should not have to know that, so the pair is lifted onto the task
// itself. dailyLog is left in place: the board already reads
// dailyLog.assignedUser and would break if it vanished.
const liftAssignee = (json: any): any => {
  const log = json.dailyLog ?? null;
  json.assigned_to = log?.assigned_to ?? null;
  json.created_by = log?.created_by ?? null;
  json.assignedUser = log?.assignedUser ?? null;
  return json;
};

// Newest last, matching the order they were appended in. `comment_count` is
// always the TRUE length, so `comment_count > comments.length` is how a client
// knows older ones exist - there is no "load older" route until it bites.
//
// `authors` resolves each comment's user_id to the LIVE user, so a rename shows
// through on old comments. The `user_name` snapshot stored at write time is the
// fallback for a user who has since been deleted: there is no FK on user_id, so
// without it a deleted author's comments would render with no name at all.
const decorateComments = (json: any, authors: Map<string, UserLite>): any => {
  const all: TaskComment[] = Array.isArray(json.comments) ? json.comments : [];
  json.comment_count = all.length;
  const page = all.length > COMMENT_PAGE_SIZE ? all.slice(-COMMENT_PAGE_SIZE) : all;
  json.comments = page.map((c) => {
    const live = authors.get(c.user_id);
    return {
      ...c,
      user_name: live?.fullName ?? c.user_name ?? null,
      user: live
        ? { id: live.id, fullName: live.fullName, email: live.email }
        : null,
    };
  });
  return json;
};

// Ascending by position, created_at as the tie-break. The tie-break matters for
// every subtask created before migration 018 ran: those all sit on position 0
// until its backfill, and without it they would come back in an arbitrary
// order rather than the order the board has always drawn them in.
const orderChildren = (children: any[]): any[] =>
  [...children].sort((a, b) => {
    const pa = Number(a.position ?? 0);
    const pb = Number(b.position ?? 0);
    if (pa !== pb) return pa - pb;
    const ca = new Date(a.created_at ?? 0).getTime();
    const cb = new Date(b.created_at ?? 0).getTime();
    return ca - cb;
  });

// Section 4(a) as the client sees it.
//
// A child is blocked when its parent is `sequential` and some sibling with a
// LOWER position has not been completed. `blocked_by` names the earliest such
// sibling and who has it, so the row can say what it is waiting on instead of
// just being greyed out.
//
// A child that has already started, or already finished, is never blocked -
// is_blocked answers "can the Start button be pressed", and for those two there
// is no Start button to disable. Compared on `position` rather than on array
// index so two children deliberately given the same position are peers and do
// not block each other.
//
// This is the same rule PATCH /updateTask enforces. That endpoint is the
// authority - the flag here only lets the UI disable the button up front, and
// the 409 is the backstop for two people clicking in the same moment.
const applyBlocking = (parent: any, ordered: any[]): void => {
  const sequential = parent.sequential === true;
  for (const child of ordered) {
    const status = slug(child.status);
    if (!sequential || status === "completed" || status === "in_progress") {
      child.is_blocked = false;
      child.blocked_by = null;
      continue;
    }
    const childPos = Number(child.position ?? 0);
    const blocker = ordered.find(
      (sibling) =>
        Number(sibling.position ?? 0) < childPos &&
        slug(sibling.status) !== "completed"
    );
    child.is_blocked = !!blocker;
    child.blocked_by = blocker
      ? {
          id: blocker.id,
          description: blocker.description,
          assignedUser: blocker.assignedUser ?? null,
        }
      : null;
  }
};

// Every user id referenced by a comment anywhere in this page of tasks, parents
// and children alike. Collected up front so the names cost ONE query for the
// whole response instead of one per comment.
export const collectCommentUserIds = (rows: any[]): string[] => {
  const ids = new Set<string>();
  const visit = (row: any) => {
    if (!row) return;
    const json = row && typeof row.toJSON === "function" ? row.toJSON() : row;
    const comments = Array.isArray(json.comments) ? json.comments : [];
    for (const c of comments) {
      if (c && typeof c.user_id === "string") ids.add(c.user_id);
    }
    for (const child of json.subtasks ?? []) visit(child);
  };
  for (const row of rows ?? []) visit(row);
  return [...ids];
};

export const decorateTask = (
  row: any,
  authors: Map<string, UserLite> = new Map()
): any => {
  const json = decorateComments(liftAssignee(toPlain(row)), authors);

  const children = (json.subtasks ?? []).map((child: any) =>
    decorateComments(liftAssignee(toPlain(child)), authors)
  );
  const ordered = orderChildren(children);
  applyBlocking(json, ordered);
  json.subtasks = ordered;

  // Convenience counts the board already derives by hand. Additive.
  json.subtask_count = ordered.length;
  json.subtask_done_count = ordered.filter(
    (c: any) => slug(c.status) === "completed"
  ).length;

  return json;
};

// The comment treatment on its own, for a response that returns a single row
// without its children — PATCH /updateTask's own task.
//
// Deliberately does NOT touch `subtasks`: that read does not fetch them, and
// decorateTask would set the key to `[]`, which a client holding a real
// subtask list would read as "they were all deleted".
export const capComments = (
  row: any,
  authors: Map<string, UserLite> = new Map()
): any => decorateComments(toPlain(row), authors);

export const decorateTasks = (
  rows: any[],
  authors: Map<string, UserLite> = new Map()
): any[] => (rows ?? []).map((row) => decorateTask(row, authors));

export const isRealStatus = (status: unknown): boolean =>
  REAL_STATUSES.has(slug(status));

export const statusSlug = slug;
