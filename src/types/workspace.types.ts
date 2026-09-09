// Stored verbatim — the UI renders "Planning" / "Active" / "On Hold" off these
// tokens, so the strings are the contract, not the labels.
export type WorkspaceStatus = "planning" | "active" | "on_hold";

export const WORKSPACE_STATUSES: WorkspaceStatus[] = [
  "planning",
  "active",
  "on_hold",
];

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
