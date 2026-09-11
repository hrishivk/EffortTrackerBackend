// Stored verbatim — the UI renders "Planning" / "Active" / "On Hold" /
// "Completed" off these tokens, so the strings are the contract, not the labels.
//
// `completed` was added in migration 019. Until then there was no way to say a
// workspace was finished, so the button next to the status had nothing to
// write. It is a normal status, not a separate flag: a workspace is in exactly
// one state, and a boolean beside the status would allow the contradiction of
// "on_hold and also complete".
export type WorkspaceStatus =
  | "planning"
  | "active"
  | "on_hold"
  | "completed";

export const WORKSPACE_STATUSES: WorkspaceStatus[] = [
  "planning",
  "active",
  "on_hold",
  "completed",
];

// The roles that may be sent a completion notice. Deliberately not "any user":
// the button would otherwise be a way to push a notification at an arbitrary
// colleague. SP, AM and MG are the three roles that manage other people.
export const NOTIFIABLE_ROLES = ["SP", "AM", "MG"];

// Same verbatim-token rule as WorkspaceStatus. The UI renders "Private" /
// "Public" off these.
export type WorkspaceVisibility = "private" | "public";

export const WORKSPACE_VISIBILITIES: WorkspaceVisibility[] = [
  "private",
  "public",
];

// Only `active` counts as membership. A `pending` row is a request and must
// never appear as a member or in an assignee list; `rejected` is a declined
// request, kept rather than deleted so a decision is auditable.
export type RoomMemberStatus = "pending" | "active" | "rejected";

export const ROOM_MEMBER_STATUSES: RoomMemberStatus[] = [
  "pending",
  "active",
  "rejected",
];

// The two a manager may set through PATCH /room-members. `pending` is not
// settable: only the join flow creates one.
export const ROOM_MEMBER_DECISIONS: RoomMemberStatus[] = ["active", "rejected"];

export interface RoomInput {
  name: string;
  description?: string | null;
  position?: number;
  member_ids: string[];
}

// What POST /role-user/workspaces creates in one transaction.
export interface WorkspaceTreeInput {
  name: string;
  code?: string | null;
  status: WorkspaceStatus;
  visibility: WorkspaceVisibility;
  description?: string | null;
  project_id: string;
  created_by: string;
  rooms: Required<RoomInput>[];
}

export interface WorkspacePatch {
  name?: string;
  code?: string | null;
  status?: WorkspaceStatus;
  visibility?: WorkspaceVisibility;
  description?: string | null;
  project_id?: string | null;
  // Set by the repository in step with `status`, never by an API caller: moving
  // to `completed` stamps both, moving away nulls both. Keeping them in step is
  // what stops a workspace claiming a completion date while it is back in
  // progress.
  completed_at?: Date | null;
  completed_by?: string | null;
}

// POST /role-user/workspaces/notify-completed
//
// Deliberately NOT part of the status change. Setting a workspace to Completed
// tells nobody: who needs to hear that a piece of work is done is a judgement
// the person finishing it makes, and firing at everyone automatically would
// make the notification worthless.
export interface NotifyCompletedInput {
  workspace_id: string;
  user_ids: string[];
}

// One announce may name at most this many people. A cap rather than no limit
// because each id becomes a row, and the picker is a tick-list that a stray
// select-all could turn into hundreds.
export const MAX_ANNOUNCE_RECIPIENTS = 50;

// One recipient of a completion notice, as the picker needs it.
export interface NotifyTarget {
  id: string;
  fullName: string | null;
  email: string | null;
  role: string;
  // true for the caller's own manager, so the picker can pre-select them.
  is_my_manager: boolean;
}

// The completion badge beside the workspace status, on EVERY workspace read.
// Null for a workspace that is not completed, so `completion_notice !== null`
// is the single test for "draw the badge".
//
// Read back from the notifications that were actually raised, rather than
// stored on the workspace: those rows ARE the record of who was told, so a
// second copy could disagree with them.
export interface CompletionNotice {
  count: number;
  // How many of those managers have not opened it yet, so the icon can
  // distinguish "told" from "seen".
  unread_count: number;
  last_sent_at: Date | string | null;
  notified: Array<{
    id: string;
    // Null once the account is deleted — a notification row outlives its user.
    fullName: string | null;
    email: string | null;
    read: boolean;
    notified_at: Date | string;
  }>;
  // Present ONLY on the PATCH that attempted to send notices, never on a plain
  // read. Ids that named a non-manager, an unknown user, or the caller.
  // Reported rather than thrown, so a stale picker entry cannot undo a
  // completion that already succeeded.
  skipped?: Array<{ id: string; reason: string }>;
}

export interface RoomCreateInput {
  workspace_id: string;
  project_id?: string | null;
  name: string;
  description?: string | null;
  position?: number;
}

export interface RoomPatch {
  name?: string;
  description?: string | null;
  position?: number;
}

// ── Reader context ──────────────────────────────────────────────────────────
//
// Resolved once per read and threaded through the repository, so the rooms a
// caller may see, and whether they may manage the workspace, are decided in one
// place rather than at each embed site.
export interface WorkspaceViewer {
  userId: string;
  role?: string;
  // true for SP and for the AM who created the workspace. Sent to the client as
  // `can_manage` so the copy-key button can be gated on a server decision
  // instead of a guess from user.role.
  canManage: boolean;
  // undefined  -> every room (a manager)
  // string[]   -> only these rooms (a plain member; may be empty)
  visibleRoomIds?: string[];
}

// What a caller who may NOT read a private workspace gets back, on a 200.
//
// Deliberately four fields and no more. This is the entire disclosure surface
// for someone who guesses an id, so it carries the name the lock screen needs to
// say WHICH workspace is being asked about, and nothing else — no code (that is
// the credential being asked for), no project, rooms, members or created_by.
export interface LockedWorkspaceStub {
  id: string;
  name: string;
  visibility: WorkspaceVisibility;
  locked: true;
}

// ── Join flow ───────────────────────────────────────────────────────────────

export interface JoinRequestInput {
  key: string;
  room_id?: string | null;
}

export type JoinOutcome =
  // The key was right: this SESSION can now see the workspace, and a room
  // request is queued for a manager (201).
  | "unlocked"
  // The key was right but no session id was available to scope an unlock to
  // (a token minted before the `sid` claim existed). The room request is
  // queued; the caller has to sign in again to get the session unlock (201).
  | "requested"
  // Already an active member — nothing to do (200).
  | "already_member"
  // A request for this room was already waiting (200, no duplicate row).
  | "already_pending";
