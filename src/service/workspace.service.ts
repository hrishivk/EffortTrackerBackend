import { Op } from "sequelize";
import { WorkspaceRepository } from "../repositories/workspace.repository";
import { Role } from "../Enums/Role";
import { RateLimiter } from "../utils/rateLimiter";
import { NotificationRepository } from "../repositories/notification.repository";
import {
  MAX_ANNOUNCE_RECIPIENTS,
  JoinOutcome,
  LockedWorkspaceStub,
  RoomInput,
  RoomMemberStatus,
  ROOM_MEMBER_DECISIONS,
  ROOM_MEMBER_STATUSES,
  WorkspacePatch,
  WorkspaceStatus,
  WorkspaceViewer,
  WorkspaceVisibility,
  WORKSPACE_STATUSES,
  WORKSPACE_VISIBILITIES,
} from "../types/workspace.types";

const workspaceRepository = new WorkspaceRepository();
const notificationRepo = new NotificationRepository();

// 10 join attempts per user per 5 minutes. A correct key is not counted (see
// RateLimiter.forget), so this only ever bites someone guessing.
const joinLimiter = new RateLimiter(10, 5 * 60 * 1000);

// Only SP and AM may create or change a workspace — the same two roles that can
// open /:role/workspace-setup. Everyone else gets a 403 on a write but can
// still READ the workspaces they are a member of.
const MANAGING_ROLES: string[] = [Role.SuperAdmin, Role.Admin];

// Accepts the array the picker sends, or a comma-separated string, and returns
// trimmed, de-duplicated ids. Same shape of leniency as normalizeTags on the
// task side, so the two create paths behave alike.
const normalizeIdList = (input: unknown): string[] => {
  if (input === undefined || input === null) return [];
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
    ? input.split(",")
    : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" && typeof item !== "number") continue;
    const id = String(item).trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

// Field limits. Matched to the inputs so the frontend can cap at the same
// numbers instead of discovering them from a 400.
const MAX_NAME = 60;
const MAX_CODE = 20;
const MAX_DESCRIPTION = 2000;
const MAX_ROOM_NAME = 40;
const MAX_ROOM_DESCRIPTION = 200;

// A private workspace the caller may not see is reported as MISSING, not
// forbidden. A 403 would confirm the workspace exists, which turns the join
// endpoint into a way to enumerate workspaces by guessing keys.
const NOT_FOUND = "Workspace not found";

// Same reasoning one level down: a room the caller is not an active member of
// is reported missing, not forbidden.
const ROOM_NOT_FOUND = "Room not found";

// 409 from the announce route: the message it sends asserts the work is
// finished, so it refuses a workspace that is not.
const WORKSPACE_NOT_COMPLETED = "Workspace is not completed";

const requireManagingRole = (callerRole?: string) => {
  if (!callerRole || !MANAGING_ROLES.includes(callerRole)) {
    throw new Error("Not authorized to manage workspaces");
  }
};

const validateName = (name: unknown): string => {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Workspace name is required");
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_NAME) {
    throw new Error(`Workspace name must be ${MAX_NAME} characters or fewer`);
  }
  return trimmed;
};

// The UI omits `code` when blank rather than sending "". Treat "" the same way
// anyway — a blank key is no key, not a key that is the empty string, which
// would collide with every other blank one under the unique index.
const validateCode = (code: unknown): string | null => {
  if (code === null || code === undefined) return null;
  if (typeof code !== "string") {
    throw new Error("Workspace code must be a string");
  }
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CODE) {
    throw new Error(`Workspace code must be ${MAX_CODE} characters or fewer`);
  }
  return trimmed.toUpperCase();
};

const validateStatus = (status: unknown): WorkspaceStatus => {
  if (typeof status !== "string" || !status.trim()) {
    throw new Error("Workspace status is required");
  }
  const value = status.trim();
  if (!WORKSPACE_STATUSES.includes(value as WorkspaceStatus)) {
    throw new Error(
      `Workspace status must be one of: ${WORKSPACE_STATUSES.join(", ")}`
    );
  }
  return value as WorkspaceStatus;
};

const validateVisibility = (visibility: unknown): WorkspaceVisibility => {
  if (typeof visibility !== "string" || !visibility.trim()) {
    throw new Error("Workspace visibility is required");
  }
  const value = visibility.trim();
  if (!WORKSPACE_VISIBILITIES.includes(value as WorkspaceVisibility)) {
    throw new Error(
      `Workspace visibility must be one of: ${WORKSPACE_VISIBILITIES.join(", ")}`
    );
  }
  return value as WorkspaceVisibility;
};

const validateRoomDescription = (description: unknown): string | null => {
  if (description === null || description === undefined) return null;
  if (typeof description !== "string") {
    throw new Error("Room description must be a string");
  }
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ROOM_DESCRIPTION) {
    throw new Error(
      `Room description must be ${MAX_ROOM_DESCRIPTION} characters or fewer`
    );
  }
  return trimmed;
};

const validateDecision = (status: unknown): RoomMemberStatus => {
  if (typeof status !== "string" || !status.trim()) {
    throw new Error("Membership status is required");
  }
  const value = status.trim();
  if (!ROOM_MEMBER_DECISIONS.includes(value as RoomMemberStatus)) {
    throw new Error(
      `Membership status must be one of: ${ROOM_MEMBER_DECISIONS.join(", ")}`
    );
  }
  return value as RoomMemberStatus;
};

const validateDescription = (description: unknown): string | null => {
  if (description === null || description === undefined) return null;
  if (typeof description !== "string") {
    throw new Error("Workspace description must be a string");
  }
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_DESCRIPTION) {
    throw new Error(
      `Workspace description must be ${MAX_DESCRIPTION} characters or fewer`
    );
  }
  return trimmed;
};

const validateRoomName = (name: unknown): string => {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Room name is required");
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_ROOM_NAME) {
    throw new Error(`Room name must be ${MAX_ROOM_NAME} characters or fewer`);
  }
  return trimmed;
};

const validatePosition = (position: unknown): number => {
  const parsed = Number(position);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Position must be a non-negative integer");
  }
  return parsed;
};

// The frontend already gates these three (Continue stays disabled), but a
// payload is a payload — validate rather than trust the client.
const validateRooms = (rooms: unknown) => {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    throw new Error("At least one room is required");
  }
  return rooms.map((room: any, index: number): Required<RoomInput> => {
    const name = validateRoomName(room?.name);
    const member_ids = room?.member_ids;
    if (!Array.isArray(member_ids) || member_ids.length === 0) {
      throw new Error(`Room "${name}" needs at least one member`);
    }
    const ids = member_ids.map((id: unknown) => {
      if (typeof id !== "string" || !id.trim()) {
        throw new Error(`Room "${name}" has an invalid member id`);
      }
      return id.trim();
    });
    // The same person appearing in SEVERAL rooms of this payload is allowed:
    // the wizard's Review step lists every room a person is in, comma-separated,
    // and its pool offers anyone not already in the room being filled. Only a
    // duplicate WITHIN one room is wrong, and that is caught here so the caller
    // learns which room rather than getting a unique-constraint error naming
    // neither the person nor the room.
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Room "${name}" lists the same member twice`);
    }
    return {
      name,
      description: validateRoomDescription(room?.description),
      position: room?.position === undefined ? index : validatePosition(room.position),
      member_ids: ids,
    };
  });
};

const validateProjectId = async (project_id: unknown): Promise<string> => {
  if (typeof project_id !== "string" || !project_id.trim()) {
    throw new Error("A project is required");
  }
  const id = project_id.trim();
  if (!(await workspaceRepository.projectExists(id))) {
    throw new Error("Project not found");
  }
  return id;
};

export class WorkspaceService {
  // ── Visibility ────────────────────────────────────────────────────────────
  //
  // There is no SQL-level visibility filter any more. The list fetches every
  // workspace and resolveViewer decides each row, because a row the caller may
  // not read is returned as a locked stub rather than omitted — the sidebar
  // tree needs it in order to offer "Enter workspace key".
  //
  // The gate itself lives in resolveViewer, in one place, so the list and the
  // detail read cannot drift apart.

  // The one place a caller's rights over a workspace are decided, so the room
  // scope and can_manage cannot drift apart between endpoints.
  //
  // Returns null when the caller may not read this private workspace. The
  // CALLER decides what null means, because the two readers want different
  // answers for it:
  //
  //   getWorkspace  -> a 200 locked stub, so the lock screen can name the
  //                    workspace it is asking about
  //   getRoom       -> a 404, unchanged; a room is not a thing you unlock with
  //                    a key, so there is nothing for a stub to render
  //
  // Note what this gives up, since it was an explicit ask in the other
  // direction earlier: the stub confirms a workspace EXISTS and names it, so a
  // private workspace is no longer indistinguishable from one that does not
  // exist. That is the accepted trade for a lock screen that can say "Beatx".
  // Ids are `WS_` + 12 random alphanumerics, so the id-guessing route into that
  // stub is not a practical one.
  private async resolveViewer(
    callerId: string,
    callerRole: string | undefined,
    workspace: {
      id: string;
      created_by: string | null;
      visibility?: string;
    },
    sid?: string
  ): Promise<WorkspaceViewer | null> {
    // Two independent questions, deliberately answered in this order:
    //
    //   1. THE GATE — may this caller open the workspace at all? Returning null
    //      means locked, and the reader turns that into a stub or a 404.
    //   2. THE SCOPE — given they are in, which rooms do they see?
    //
    // They used to be tangled together, with an active room membership doubling
    // as its own gate pass. Separating them is what makes "private means
    // locked, members included" a change to step 1 only, leaving step 2 alone:
    // a member who unlocks gets their rooms because room_members grants those,
    // not because membership skipped the lock.
    const isSP = callerRole === Role.SuperAdmin;
    const isCreator = workspace.created_by === callerId;

    // The people who hand the key out never meet the lock, and see every room.
    if (isSP || isCreator) {
      return { userId: callerId, role: callerRole, canManage: true };
    }

    // ── 1. The gate ──
    const isPublic = workspace.visibility === "public";

    // A private workspace is locked to EVERYONE else — an active room
    // membership no longer exempts anybody. Only this session having typed the
    // key opens it.
    let unlockedThisSession = false;
    if (!isPublic && sid) {
      const unlocked = await workspaceRepository.unlockedWorkspaceIds(
        sid,
        callerId
      );
      unlockedThisSession = unlocked.includes(workspace.id);
    }

    if (!isPublic && !unlockedThisSession) return null;

    // ── 2. The scope ──
    //
    // Past the gate, rooms come from membership and nothing else. A member sees
    // theirs; a non-member who unlocked with the key sees an empty array, which
    // is honoured as "no rooms" rather than "all rooms".
    const rooms = await workspaceRepository.roomIdsForMember(
      workspace.id,
      callerId
    );

    return {
      userId: callerId,
      role: callerRole,
      canManage: false,
      visibleRoomIds: rooms,
    };
  }

  private lockedStub(workspace: {
    id: string;
    name: string;
    visibility?: string;
  }): LockedWorkspaceStub {
    return {
      id: workspace.id,
      name: workspace.name,
      // Necessarily "private" — a public workspace never locks — but read from
      // the row rather than hard-coded, so the two cannot disagree.
      visibility: (workspace.visibility ?? "private") as WorkspaceVisibility,
      locked: true,
    };
  }

  // A write needs BOTH a managing role and visibility of the workspace: an AM
  // may manage workspaces, but not somebody else's.
  //
  // Ordered deliberately: the role check runs FIRST, so a plain user gets a 403
  // for attempting a write at all. Only a caller who could in principle manage
  // a workspace gets told whether this particular one exists.
  private async assertCanManage(
    callerId: string,
    callerRole: string | undefined,
    workspace: { id: string; created_by: string | null; visibility?: string }
  ) {
    requireManagingRole(callerRole);
    if (callerRole === Role.SuperAdmin) return;
    if (workspace.created_by !== callerId) {
      // Another AM's workspace: missing, not forbidden. An AM has no more right
      // to learn it exists than anyone else does.
      throw new Error(NOT_FOUND);
    }
  }

  private managingViewer(
    callerId: string,
    callerRole: string | undefined
  ): WorkspaceViewer {
    return { userId: callerId, role: callerRole, canManage: true };
  }

  // ── Workspaces ────────────────────────────────────────────────────────────

  // GET /role-user/workspaces
  //
  // Two separate decisions per row, and keeping them apart is the whole point:
  //
  //   THE CLAIM     is this workspace this caller's business at all?
  //                 No  -> omitted entirely.
  //   THE LOCK      may they read it yet?
  //                 No  -> the locked stub.
  //
  // Before this, every private workspace in the organisation came back as a
  // stub to everybody, which made the stub ambiguous: a member's own
  // not-yet-unlocked workspace and a total stranger's were byte-identical, so
  // the client could not tell "yours, go unlock it" from "none of your
  // business". Filtering by claim collapses that — **a stub in this response
  // now always means "yours, not yet unlocked"**.
  //
  // A caller has a claim on a workspace when any of these holds:
  //
  //   * they created it
  //   * it is public
  //   * they have a room_members row in it (any status — see
  //     workspaceIdsWithMembership for why not just active)
  //   * they have unlocked it this session
  //
  // SP is exempt from the filter and sees everything.
  //
  // Note this is a LIST rule only. GET /workspaces?id= still returns the stub
  // to anyone who asks for a real id, because a pasted URL has to reach the key
  // prompt — a stranger there is the case the lock screen exists for.
  public async listWorkspaces(
    callerId: string,
    callerRole?: string,
    sid?: string
  ) {
    try {
      const isSP = callerRole === Role.SuperAdmin;
      const rows = await workspaceRepository.list({});

      if (isSP) {
        return await Promise.all(
          rows.map((row: any) =>
            workspaceRepository.decorateListRow(row, {
              userId: callerId,
              role: callerRole,
              canManage: true,
            })
          )
        );
      }

      // Three lookups for the whole list rather than per row.
      const [roomIds, unlocked, memberOf] = await Promise.all([
        workspaceRepository.roomIdsForUser(callerId),
        sid
          ? workspaceRepository.unlockedWorkspaceIds(sid, callerId)
          : Promise.resolve([]),
        workspaceRepository.workspaceIdsWithMembership(callerId),
      ]);

      const decorated = await Promise.all(
        rows.map(async (row: any) => {
          const isCreator = row.created_by === callerId;
          const isPublic = row.visibility === "public";
          const hasMembership = memberOf.includes(row.id);
          const unlockedThisSession = unlocked.includes(row.id);

          // ── The claim ──
          if (
            !isCreator &&
            !isPublic &&
            !hasMembership &&
            !unlockedThisSession
          ) {
            return null;
          }

          // ── The lock ──
          //
          // Same gate as resolveViewer: an active room membership does NOT open
          // a private workspace (Round 7). So a member with a claim but no
          // session unlock gets the stub — which is exactly the
          // "yours, not yet unlocked" the sidebar needs.
          if (!isCreator && !isPublic && !unlockedThisSession) {
            return this.lockedStub(row);
          }

          return await workspaceRepository.decorateListRow(row, {
            userId: callerId,
            role: callerRole,
            canManage: isCreator,
            // A creator sees every room of their own workspace; everyone else
            // sees only the rooms they are in.
            visibleRoomIds: isCreator ? undefined : roomIds,
          });
        })
      );

      return decorated.filter((row) => row !== null);
    } catch (error) {
      throw error;
    }
  }

  public async getWorkspace(
    callerId: string,
    callerRole: string | undefined,
    id: string,
    sid?: string
  ) {
    try {
      if (!id) throw new Error("Workspace id is required");
      // Two reads: the bare row decides the caller's rights, then the scoped
      // read embeds only the rooms those rights allow.
      //
      // A workspace that does not exist is still a 404. Only a private one the
      // caller may not read returns the stub — the lock screen is reached with
      // a real id, whether clicked or pasted.
      const raw = await workspaceRepository.findRaw(id);
      if (!raw) throw new Error(NOT_FOUND);

      const viewer = await this.resolveViewer(callerId, callerRole, raw, sid);
      if (!viewer) return this.lockedStub(raw);

      return await workspaceRepository.findById(id, viewer);
    } catch (error) {
      throw error;
    }
  }

  // The one call the wizard makes. Everything is validated before the
  // transaction opens, so the common failure is a 400 with nothing written
  // rather than a rollback.
  public async createWorkspace(
    callerId: string,
    callerRole: string | undefined,
    body: any
  ) {
    try {
      requireManagingRole(callerRole);

      const name = validateName(body?.name);
      const code = validateCode(body?.code);
      const status = validateStatus(body?.status);
      // Defaults to private when the wizard omits it, matching the column
      // default — a workspace is never published by omission.
      const visibility =
        body?.visibility === undefined
          ? "private"
          : validateVisibility(body.visibility);
      const description = validateDescription(body?.description);
      const project_id = await validateProjectId(body?.project_id);
      const rooms = validateRooms(body?.rooms);

      if (code && (await workspaceRepository.findByCode(code))) {
        throw new Error("A workspace with that code already exists");
      }

      // Check the assignees up front so a typo'd id comes back as a 400 naming
      // it, not as a foreign-key violation from inside the transaction.
      const allMemberIds = [...new Set(rooms.flatMap((r) => r.member_ids))];
      const missing = await workspaceRepository.missingUserIds(allMemberIds);
      if (missing.length > 0) {
        throw new Error(`Unknown user ids: ${missing.join(", ")}`);
      }

      return await workspaceRepository.createTree({
        name,
        code,
        status,
        visibility,
        description,
        project_id,
        created_by: callerId,
        rooms,
      });
    } catch (error: any) {
      if (error?.name === "SequelizeUniqueConstraintError") {
        throw new Error("A workspace with that code already exists");
      }
      throw error;
    }
  }

  public async updateWorkspace(
    callerId: string,
    callerRole: string | undefined,
    id: string,
    body: any
  ) {
    try {
      if (!id) throw new Error("Workspace id is required");
      const workspace = await workspaceRepository.findRaw(id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      const patch: WorkspacePatch = {};
      if ("name" in body) patch.name = validateName(body.name);
      if ("code" in body) patch.code = validateCode(body.code);
      if ("status" in body) patch.status = validateStatus(body.status);
      if ("visibility" in body)
        patch.visibility = validateVisibility(body.visibility);
      if ("description" in body)
        patch.description = validateDescription(body.description);
      if ("project_id" in body) {
        // An explicit null detaches the project; anything else must resolve.
        patch.project_id =
          body.project_id === null
            ? null
            : await validateProjectId(body.project_id);
      }

      // ── Completion bookkeeping ──────────────────────────────────────────
      //
      // completed_at / completed_by are derived here, never accepted from the
      // caller: they are a record of what the server did, so letting a client
      // set them would let it backdate a completion or credit someone else.
      //
      // Kept strictly in step with `status`. Moving TO completed stamps both;
      // moving AWAY from completed clears both, so a reopened workspace can
      // never still carry a completion date. Re-sending `completed` on an
      // already-completed workspace leaves the original stamp alone — the first
      // completion is the real one.
      const wasCompleted = workspace.status === "completed";
      if (patch.status !== undefined) {
        if (patch.status === "completed" && !wasCompleted) {
          patch.completed_at = new Date();
          patch.completed_by = callerId;
        } else if (patch.status !== "completed" && wasCompleted) {
          patch.completed_at = null;
          patch.completed_by = null;
        }
      }

      // Announcing is NOT part of this call, deliberately. Completing a
      // workspace tells nobody: who needs to hear that a piece of work is done
      // is a judgement the person finishing it makes, and firing at everybody
      // automatically would make the notification worthless. That is what
      // POST /workspaces/notify-completed exists for.
      //
      // An earlier build accepted `notify_user_ids` here. Removed rather than
      // kept as an alias: two routes writing the same notification rows drift
      // apart, and this one made announcing a side effect of a status edit.

      if (Object.keys(patch).length === 0) {
        throw new Error(
          "Nothing to update: send name, code, status, visibility, description or project_id"
        );
      }

      if (patch.code) {
        const clash = await workspaceRepository.findByCode(patch.code, id);
        if (clash) {
          throw new Error("A workspace with that code already exists");
        }
      }

      return await workspaceRepository.update(
        workspace,
        patch,
        this.managingViewer(callerId, callerRole)
      );
    } catch (error: any) {
      if (error?.name === "SequelizeUniqueConstraintError") {
        throw new Error("A workspace with that code already exists");
      }
      throw error;
    }
  }

  // GET /role-user/workspaces/notify-targets
  //
  // The picker's options. Managing roles only, matching who may press the
  // button in the first place — a plain member cannot complete a workspace, so
  // they have no use for the list.
  public async listNotifyTargets(
    callerId: string,
    callerRole: string | undefined
  ) {
    requireManagingRole(callerRole);
    return await workspaceRepository.notifiableManagers(callerId);
  }

  // POST /role-user/workspaces/notify-completed
  //
  // The Announce it strip. This is the ONLY place the frontend raises a
  // notification rather than reading one — every other notification is emitted
  // by the API off its own events — which is why the validation below is strict
  // and entirely up front: a bad request must write nothing at all.
  //
  // Announcing is deliberately not a side effect of the status change. See the
  // note in updateWorkspace.
  public async notifyCompleted(
    callerId: string,
    callerRole: string | undefined,
    body: any
  ): Promise<{ notified: number; announced_at: Date }> {
    const workspace_id = String(body?.workspace_id ?? "").trim();
    if (!workspace_id) throw new Error("Workspace id is required");

    // 404. Loaded with its project because the message names it.
    const workspace = await workspaceRepository.findRawWithProject(workspace_id);
    if (!workspace) throw new Error(NOT_FOUND);

    // 403 when the caller role cannot manage workspaces at all.
    //
    // One deliberate deviation from the spec: a workspace belonging to a
    // DIFFERENT AM answers 404, not 403, because that is what every other
    // workspace read does. A 403 there would confirm the workspace exists,
    // which is exactly what the key-guessing defence is built to prevent.
    await this.assertCanManage(callerId, callerRole, workspace as any);

    // 409. The message asserts the work is finished, so announcing an
    // unfinished workspace would put a false statement in somebody bell.
    if (workspace.status !== "completed") {
      throw new Error(WORKSPACE_NOT_COMPLETED);
    }

    const user_ids = normalizeIdList(body?.user_ids);
    if (!user_ids.length) {
      throw new Error("user_ids must name at least one recipient");
    }
    if (user_ids.length > MAX_ANNOUNCE_RECIPIENTS) {
      throw new Error(
        `user_ids must name at most ${MAX_ANNOUNCE_RECIPIENTS} recipients`
      );
    }

    // 400, naming the offending entry. Every id must be one that
    // notify-targets would have returned; a failure here means the picker is
    // out of date, so saying WHICH entry is stale is the useful answer.
    const bad = await workspaceRepository.invalidNotifyTargets(
      callerId,
      user_ids
    );
    if (bad.length) {
      const first = bad[0];
      throw new Error(
        `user_ids[${first.index}] (${first.id}) is not a valid recipient: ${first.reason}`
      );
    }

    const [actor]: any[] = await workspaceRepository.usersLite([callerId]);
    const actorName = actor?.fullName || "Someone";
    const projectName = (workspace as any).project?.name;

    // Rendered verbatim by the client, so the wording IS the contract:
    //   "WebApps" (Effort Tracker) has been marked completed by Lakshman.
    // The project clause is dropped rather than left blank when the workspace
    // has no project, so an empty "()" never ships to the bell.
    const message = projectName
      ? `"${workspace.name}" (${projectName}) has been marked completed by ${actorName}.`
      : `"${workspace.name}" has been marked completed by ${actorName}.`;

    // One row per recipient. No uniqueness check and no dedupe against earlier
    // announces: sending twice is allowed, because a reminder is legitimate.
    await notificationRepo.createMany(user_ids, {
      type: "workspace_completed",
      title: "Workspace Completed",
      message,
      // The WORKSPACE id. The client opens /{role}/workspace?ws=<reference_id>
      // from it, so any other id here produces a dead link.
      reference_id: workspace.id,
    });

    // Stamped only after the rows are written, so a failed announce never
    // leaves the strip claiming somebody was told.
    const announced_at = new Date();
    await workspaceRepository.markAnnounced(workspace, announced_at);

    return { notified: user_ids.length, announced_at };
  }

  // DELETE /role-user/workspaces?id=…
  //
  // Destructive and not reversible: the workspace, its rooms, its memberships
  // and the tasks that live in those rooms all go. The project the workspace
  // covered, and the domain/department behind it, are left standing — they
  // outlive any one workspace. See workspaceRepository.remove for the exact
  // boundary.
  public async deleteWorkspace(
    callerId: string,
    callerRole: string | undefined,
    id: string
  ) {
    try {
      if (!id) throw new Error("Workspace id is required");
      const workspace = await workspaceRepository.findRaw(id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);
      return await workspaceRepository.remove(workspace);
    } catch (error) {
      throw error;
    }
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  public async createRoom(
    callerId: string,
    callerRole: string | undefined,
    body: any
  ) {
    try {
      const workspace_id = body?.workspace_id;
      if (typeof workspace_id !== "string" || !workspace_id.trim()) {
        throw new Error("Workspace id is required");
      }
      const workspace = await workspaceRepository.findRaw(workspace_id.trim());
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      const name = validateRoomName(body?.name);
      const description = validateRoomDescription(body?.description);
      const position =
        body?.position === undefined ? undefined : validatePosition(body.position);

      // project_id is optional in the payload: the room belongs to the
      // workspace's project unless the caller names one, which is what the
      // multi-project shape would send.
      let project_id: string | null = workspace.project_id;
      if (body?.project_id !== undefined && body.project_id !== null) {
        project_id = await validateProjectId(body.project_id);
      }

      return await workspaceRepository.createRoom({
        workspace_id: workspace.id,
        project_id,
        name,
        description,
        position,
      });
    } catch (error) {
      throw error;
    }
  }

  public async updateRoom(
    callerId: string,
    callerRole: string | undefined,
    id: string,
    body: any
  ) {
    try {
      if (!id) throw new Error("Room id is required");
      const room = await workspaceRepository.findRoom(id);
      if (!room) throw new Error(ROOM_NOT_FOUND);
      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      const patch: {
        name?: string;
        description?: string | null;
        position?: number;
      } = {};
      if ("name" in body) patch.name = validateRoomName(body.name);
      if ("description" in body)
        patch.description = validateRoomDescription(body.description);
      if ("position" in body) patch.position = validatePosition(body.position);
      if (Object.keys(patch).length === 0) {
        throw new Error("Nothing to update: send name, description or position");
      }

      return await workspaceRepository.updateRoom(room, patch);
    } catch (error) {
      throw error;
    }
  }

  public async deleteRoom(
    callerId: string,
    callerRole: string | undefined,
    id: string
  ) {
    try {
      if (!id) throw new Error("Room id is required");
      const room = await workspaceRepository.findRoom(id);
      if (!room) throw new Error(ROOM_NOT_FOUND);
      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);
      return await workspaceRepository.removeRoom(room);
    } catch (error) {
      throw error;
    }
  }

  // ── Room members ──────────────────────────────────────────────────────────

  // POST is a plain ADD. The drag in the UI adds someone to this room and
  // leaves their other rooms alone, so a person can be in several rooms of one
  // workspace. Repeating it is a no-op, not a duplicate.
  public async addRoomMember(
    callerId: string,
    callerRole: string | undefined,
    body: any
  ) {
    try {
      const room_id = body?.room_id;
      const user_id = body?.user_id;
      if (typeof room_id !== "string" || !room_id.trim()) {
        throw new Error("Room id is required");
      }
      if (typeof user_id !== "string" || !user_id.trim()) {
        throw new Error("User id is required");
      }

      const room = await workspaceRepository.findRoom(room_id.trim());
      if (!room) throw new Error(ROOM_NOT_FOUND);
      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      const missing = await workspaceRepository.missingUserIds([user_id.trim()]);
      if (missing.length > 0) {
        throw new Error(`Unknown user ids: ${missing.join(", ")}`);
      }

      return await workspaceRepository.addMemberToRoom(
        room.workspace_id,
        room.id,
        user_id.trim(),
        callerId
      );
    } catch (error) {
      throw error;
    }
  }

  public async removeRoomMember(
    callerId: string,
    callerRole: string | undefined,
    room_id: string,
    user_id: string
  ) {
    try {
      if (!room_id) throw new Error("Room id is required");
      if (!user_id) throw new Error("User id is required");

      const room = await workspaceRepository.findRoom(room_id);
      if (!room) throw new Error(ROOM_NOT_FOUND);
      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      return await workspaceRepository.removeMember(room.id, user_id);
    } catch (error) {
      throw error;
    }
  }

  // ── Room reads ────────────────────────────────────────────────────────────

  // GET /role-user/rooms?id=<id>. Point 3 applied to a direct room read: a user
  // asking for a room they are not an active member of gets a 404 — the same
  // answer they would get for a room that does not exist.
  public async getRoom(
    callerId: string,
    callerRole: string | undefined,
    id: string,
    sid?: string
  ) {
    try {
      if (!id) throw new Error("Room id is required");
      const room = await workspaceRepository.findRoom(id);
      if (!room) throw new Error(ROOM_NOT_FOUND);

      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);

      // A room is not something you unlock with a key, so there is no stub
      // here: a caller who cannot read the workspace, or who can read it but is
      // not in THIS room, gets the same 404 either way.
      const viewer = await this.resolveViewer(
        callerId,
        callerRole,
        workspace,
        sid
      );
      if (!viewer) throw new Error(ROOM_NOT_FOUND);
      if (viewer.visibleRoomIds && !viewer.visibleRoomIds.includes(room.id)) {
        throw new Error(ROOM_NOT_FOUND);
      }

      return await workspaceRepository.findRoomWithMembers(room.id);
    } catch (error) {
      throw error;
    }
  }

  // ── Join flow ─────────────────────────────────────────────────────────────

  // POST /role-user/workspaces/join
  //
  // A correct key does TWO things, which is how the two halves of the brief are
  // reconciled — they pull in opposite directions otherwise:
  //
  //   1. It records a SESSION-SCOPED unlock, so this login can now SEE the
  //      workspace. That dies at logout, which is the requirement: the key gets
  //      asked for again next time. It is not a room_members row, so it never
  //      appears in anybody's member list.
  //
  //   2. It queues a PENDING room request for a manager. Room access — actually
  //      getting at the work — still needs a person to approve it.
  //
  // Why split it that way: "the key must be re-asked every session" and
  // "approval grants access" cannot both be true of one durable grant, because
  // a manager's approval has to persist and a session unlock must not. So the
  // key buys visibility only, for one session, and approval buys the rooms. A
  // guessed key therefore reveals a workspace shell with no rooms and no way to
  // act in it, which is the safety the approval recommendation was after.
  //
  // A wrong key and a workspace that does not exist give the identical answer,
  // so the endpoint cannot be used to confirm a key.
  public async joinWithKey(
    callerId: string,
    callerRole: string | undefined,
    body: any,
    sid?: string
  ): Promise<{ outcome: JoinOutcome; data: any }> {
    try {
      const wait = joinLimiter.check(callerId);
      if (wait !== null) {
        throw new Error(
          `Too many join attempts. Try again in ${wait} second${
            wait === 1 ? "" : "s"
          }`
        );
      }

      const key = body?.key;
      if (typeof key !== "string" || !key.trim()) {
        throw new Error("Workspace key is required");
      }
      if (key.trim().length > MAX_CODE) {
        throw new Error(`Workspace key must be ${MAX_CODE} characters or fewer`);
      }

      const workspace = await workspaceRepository.findByCode(key.trim());
      // No such key. NOT "wrong key for workspace X" — that would leak which
      // guesses are close to a real one.
      if (!workspace) throw new Error(NOT_FOUND);

      // A correct key is a legitimate call, so it does not spend the budget.
      joinLimiter.forget(callerId);

      const existing = await workspaceRepository.findMembershipInWorkspace(
        workspace.id,
        callerId
      );

      // ── The unlock ──
      //
      // A correct key unlocks this session, FULL STOP — including for an active
      // room member. Since Round 7 a private workspace is locked to everyone
      // but SP and the creator, so membership is no longer a reason to skip
      // this: their membership decides which ROOMS they see once through the
      // gate, not whether they get through it.
      //
      // This used to sit after an "already a member, nothing to do" early
      // return, which was correct while membership implied access and became a
      // real bug the moment it did not: a member typed the right key and stayed
      // locked out.
      const alreadyUnlocked = sid
        ? (await workspaceRepository.unlockedWorkspaceIds(sid, callerId)).includes(
            workspace.id
          )
        : false;

      if (sid) {
        await workspaceRepository.recordUnlock(sid, callerId, workspace.id);
      }

      // ── The room request ──
      //
      // Separate question: does this person still need a manager to put them in
      // a room? An active member does not.
      const wantsRoom =
        body?.room_id !== undefined &&
        body?.room_id !== null &&
        body?.room_id !== "";

      // With no room named there is no specific room to compare against, so
      // being active anywhere in the workspace is enough — a manager has
      // already placed them.
      const activeAnywhere = existing.some((m) => m.status === "active");

      if (!wantsRoom && activeAnywhere) {
        return {
          outcome: alreadyUnlocked ? "already_member" : "unlocked",
          data: await this.readAfterUnlock(callerId, callerRole, workspace, sid),
        };
      }

      // Which room. An explicit room_id must belong to THIS workspace —
      // otherwise the key for one workspace would buy a request in another.
      let room_id = body?.room_id;
      if (wantsRoom) {
        if (typeof room_id !== "string") {
          throw new Error("Room id is required");
        }
        const room = await workspaceRepository.findRoom(room_id.trim());
        if (!room || room.workspace_id !== workspace.id) {
          throw new Error(ROOM_NOT_FOUND);
        }
        room_id = room.id;
      } else {
        // "Let a manager pick the room": the request is parked against the
        // first room in board order. Approving it is where the manager
        // chooses — they can add the person elsewhere afterwards with the
        // ordinary POST /room-members.
        const rooms = await workspaceRepository.roomsForWorkspace(workspace.id);
        if (rooms.length === 0) {
          throw new Error("This workspace has no rooms to join");
        }
        room_id = rooms[0].id;
      }

      // Already in the room they named: unlocked, and nothing to queue.
      const activeHere = existing.some(
        (m) => m.status === "active" && m.room_id === room_id
      );
      if (activeHere) {
        return {
          outcome: alreadyUnlocked ? "already_member" : "unlocked",
          data: await this.readAfterUnlock(callerId, callerRole, workspace, sid),
        };
      }

      // A request already waiting for this room: return it rather than adding a
      // second row, so a double-submit does not queue two.
      const pending = existing.find(
        (m) => m.status === "pending" && m.room_id === room_id
      );
      if (pending) {
        return {
          outcome: "already_pending",
          data: this.publicJoinView(workspace, pending),
        };
      }

      const membership = await workspaceRepository.requestMembership(
        workspace.id,
        room_id,
        callerId
      );

      return {
        // "requested" rather than "unlocked" when there was no sid to scope an
        // unlock to (a token minted before the claim existed): the room request
        // stands, but the next read would still be locked, so say so.
        outcome: sid ? "unlocked" : "requested",
        data: this.publicJoinView(workspace, membership),
      };
    } catch (error) {
      throw error;
    }
  }

  // The workspace as the caller can now see it, used on the join paths where no
  // room request was needed. resolveViewer is re-run rather than assumed,
  // because the unlock was written a few lines earlier and this is what the
  // caller's very next GET will return.
  private async readAfterUnlock(
    callerId: string,
    callerRole: string | undefined,
    workspace: any,
    sid?: string
  ) {
    const viewer = await this.resolveViewer(
      callerId,
      callerRole,
      workspace,
      sid
    );
    // Falls back to the stub only when there was no sid, so the unlock could
    // not be recorded and the workspace really is still locked.
    return viewer
      ? await workspaceRepository.findById(workspace.id, viewer)
      : this.lockedStub(workspace);
  }

  // What a non-member is told about a workspace they have asked to join: enough
  // to render "waiting for approval", and nothing about its rooms or people.
  private publicJoinView(workspace: any, membership: any) {
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        visibility: workspace.visibility,
      },
      membership: {
        room_id: membership.room_id,
        user_id: membership.user_id,
        status: membership.status,
        requested_at: membership.requested_at,
      },
      // What the caller can do right now, so the client does not have to infer
      // it from the outcome string:
      //   unlocked        this session may now read the workspace
      //   room_pending    a manager still has to approve the room
      unlocked: true,
      room_pending: membership.status === "pending",
    };
  }

  // GET /role-user/room-members?workspace_id=<id>&status=pending
  //
  // The manager's approval queue. SP/AM only — assertCanManage covers both the
  // role and the "not another AM's workspace" half.
  public async listRoomMembers(
    callerId: string,
    callerRole: string | undefined,
    workspace_id: string,
    status?: string
  ) {
    try {
      if (!workspace_id) throw new Error("Workspace id is required");
      const workspace = await workspaceRepository.findRaw(workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      let filter: RoomMemberStatus | undefined;
      if (status !== undefined && status !== "") {
        if (!ROOM_MEMBER_STATUSES.includes(status as RoomMemberStatus)) {
          throw new Error(
            `Membership status must be one of: ${ROOM_MEMBER_STATUSES.join(", ")}`
          );
        }
        filter = status as RoomMemberStatus;
      }

      return await workspaceRepository.listMemberships(workspace.id, filter);
    } catch (error) {
      throw error;
    }
  }

  // PATCH /role-user/room-members?room_id=<id>&user_id=<id>  { status }
  //
  // Approve or decline. The "one active room per workspace" re-check lives in
  // the repository, inside the same transaction as the status change: the
  // requester may have been given a room by a manager between asking and being
  // approved.
  public async decideRoomMember(
    callerId: string,
    callerRole: string | undefined,
    room_id: string,
    user_id: string,
    body: any
  ) {
    try {
      if (!room_id) throw new Error("Room id is required");
      if (!user_id) throw new Error("User id is required");
      const status = validateDecision(body?.status);

      const room = await workspaceRepository.findRoom(room_id);
      if (!room) throw new Error(ROOM_NOT_FOUND);
      const workspace = await workspaceRepository.findRaw(room.workspace_id);
      if (!workspace) throw new Error(NOT_FOUND);
      await this.assertCanManage(callerId, callerRole, workspace);

      const membership = await workspaceRepository.findMembership(
        room.id,
        user_id
      );
      if (!membership) throw new Error("Membership not found");

      return await workspaceRepository.decideMembership(
        membership,
        status,
        callerId
      );
    } catch (error) {
      throw error;
    }
  }
}
