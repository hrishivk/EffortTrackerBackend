import { TaskGroupRepository } from "../repositories/task-group.repository";
import { TaskGroupPatch } from "../types/task.types";
import { Role } from "../Enums/Role";
import { statusForGroup } from "../repositories/user.repository";
import { ReportDirectoryRepository } from "../repositories/report.repository";
import { superAdminRepository } from "../repositories/super-admin.repository";

const taskGroupRepository = new TaskGroupRepository();
const directory = new ReportDirectoryRepository();
const SuperAdminRepository = new superAdminRepository();

// Only SP and AM can pull up someone else's board — the same rule
// findDailyLogs applies to /task-list, so the groups a board returns always
// match the group_id values its tasks carry.
const CROSS_BOARD_ROLES: string[] = [Role.SuperAdmin, Role.Admin];

// Where a card lands when the group it was parked in is deleted. Its original
// status is unrecoverable (overwritten on the drop), so this is a choice, not a
// restore: visible-but-wrong beats invisible.
const ORPHAN_FALLBACK_STATUS = "yet_to_start";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Which board a call acts on. `assigned_to` absent (or the caller themself) is
// always the caller's own board; anything else is a cross-board call and has to
// be earned:
//
//   SP  — every board.
//   AM  — only the boards of the users they actually manage. An AM handed
//         someone else's id gets a 403 rather than a lane written onto a board
//         they have no business touching.
//   rest — no cross-board access at all.
const resolveBoardOwner = async (
  callerId: string,
  callerRole: string | undefined,
  assigned_to?: string
): Promise<string> => {
  if (!assigned_to || assigned_to === callerId) return callerId;
  if (!callerRole || !CROSS_BOARD_ROLES.includes(callerRole)) {
    throw new Error("Not authorized to view this board's groups");
  }
  if (
    callerRole === Role.Admin &&
    !(await taskGroupRepository.isBoardManagedBy(callerId, assigned_to))
  ) {
    throw new Error("Not authorized to manage this user's groups");
  }
  return assigned_to;
};


// How many boards one request may name explicitly. Bounds the authorization
// loop below, which costs a lookup per id.
const MAX_BOARDS_REQUESTED = 100;

// The boards a /task-groups/all call covers.
//
// `assigned_to` given -> exactly those boards, each put through
// resolveBoardOwner. An id outside the caller's reach is a 403, NOT a
// silently dropped entry: a missing board reads as "that person has no lanes",
// which is a different and wrong answer.
//
// `assigned_to` omitted -> every board the caller can reach, derived from
// their role, so there is nothing to refuse.
//
// The caller's OWN board is always in the set. Deliberately unlike the team
// report, which leaves the caller out because their own numbers skew a team
// average — a manager still has a board of their own and needs its lanes.
const resolveBoardSet = async (
  callerId: string,
  callerRole: string | undefined,
  assigned_to?: string
): Promise<string[]> => {
  if (assigned_to !== undefined) {
    const ids = [
      ...new Set(
        String(assigned_to)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ];
    if (!ids.length) {
      throw new Error("assigned_to must name at least one user");
    }
    if (ids.length > MAX_BOARDS_REQUESTED) {
      throw new Error(
        `assigned_to accepts at most ${MAX_BOARDS_REQUESTED} user ids`
      );
    }
    for (const id of ids) {
      await resolveBoardOwner(callerId, callerRole, id);
    }
    return ids;
  }

  if (callerRole === Role.SuperAdmin) {
    const members = await directory.allMembers();
    return [...new Set([callerId, ...members.map((member) => member.id)])];
  }

  if (callerRole === Role.Admin) {
    // The same set /role-sp/list-users and the team report resolve, so a user
    // an AM can pick is a user whose lanes they can read, and nobody else.
    const domainPeerIds = await SuperAdminRepository.getDomainPeerUserIds(
      callerId
    );
    const members = await directory.managedBy(callerId, domainPeerIds);
    return [...new Set([callerId, ...members.map((member) => member.id)])];
  }

  return [callerId];
};
// A shared lane is drawn on every board, so renaming or deleting one is not a
// change to the board it was opened from — it hits everybody. Managing someone
// else's board does not carry that, so keep it with SP.
const assertMutable = (group: { is_shared: boolean }, callerRole?: string) => {
  if (group.is_shared && callerRole !== Role.SuperAdmin) {
    throw new Error("Not authorized to change a shared group");
  }
};

const validateName = (name: unknown): string => {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Group name is required");
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw new Error("Group name must be 100 characters or fewer");
  }
  return trimmed;
};

const validateColor = (color: unknown): string | null => {
  if (color === null || color === undefined || color === "") return null;
  if (typeof color !== "string" || !HEX_COLOR.test(color.trim())) {
    throw new Error("Color must be a hex value like #7c3aed");
  }
  return color.trim();
};

const validatePosition = (position: unknown): number => {
  const parsed = Number(position);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Position must be a non-negative integer");
  }
  return parsed;
};

export class TaskGroupService {
  public async listGroups(
    callerId: string,
    callerRole?: string,
    assigned_to?: string
  ) {
    try {
      const owner = await resolveBoardOwner(callerId, callerRole, assigned_to);
      return await taskGroupRepository.listByUser(owner);
    } catch (error) {
      throw error;
    }
  }

  // Every lane the caller can see, across every board they can reach, in one
  // call — the batch twin of listGroups, which names a single board.
  //
  // Returns { id, name } only. The board the frontend draws needs the label
  // and the value it writes back to tasks.group_id, and nothing else; the
  // ARRAY ORDER carries what `position` used to, because the query orders by
  // (position, created_at) exactly as listByUser does. Do not re-sort it.
  public async listAllGroups(
    callerId: string,
    callerRole?: string,
    assigned_to?: string
  ) {
    try {
      const boardIds = await resolveBoardSet(callerId, callerRole, assigned_to);
      const groups = await taskGroupRepository.listForBoards(boardIds);
      return groups.map((group) => ({ id: group.id, name: group.name }));
    } catch (error) {
      throw error;
    }
  }


  public async createGroup(
    callerId: string,
    callerRole: string | undefined,
    data: { name?: unknown; color?: unknown; position?: unknown; assigned_to?: string }
  ) {
    try {
      const owner = await resolveBoardOwner(
        callerId,
        callerRole,
        data.assigned_to
      );
      const name = validateName(data.name);
      // New groups are always private to their owner. Reject a name that
      // already exists as a shared lane, or the board draws two lanes with the
      // same label and "status" becomes ambiguous between them.
      if (await taskGroupRepository.findSharedByName(name)) {
        throw new Error("A shared group with that name already exists");
      }
      return await taskGroupRepository.create({
        user_id: owner,
        name,
        color: validateColor(data.color),
        position:
          data.position === undefined
            ? undefined
            : validatePosition(data.position),
      });
    } catch (error: any) {
      if (error?.name === "SequelizeUniqueConstraintError") {
        throw new Error("A group with that name already exists");
      }
      throw error;
    }
  }

  public async updateGroup(
    callerId: string,
    callerRole: string | undefined,
    id: string,
    body: { name?: unknown; color?: unknown; position?: unknown }
  ) {
    try {
      if (!id) throw new Error("Group id is required");
      const group = await taskGroupRepository.findById(id);
      if (!group) throw new Error("Group not found");
      // Authorized on the group's OWNER, not on the caller: a manager renaming
      // a lane on a board they manage is the whole point of the cross-board
      // param, and that lane's user_id is never their own id.
      await resolveBoardOwner(callerId, callerRole, group.user_id);
      assertMutable(group, callerRole);

      const patch: TaskGroupPatch = {};
      if (body.name !== undefined) {
        patch.name = validateName(body.name);
        const clash = await taskGroupRepository.findSharedByName(patch.name);
        if (clash && clash.id !== group.id) {
          throw new Error("A shared group with that name already exists");
        }
      }
      if (body.color !== undefined) patch.color = validateColor(body.color);
      if (body.position !== undefined)
        patch.position = validatePosition(body.position);

      if (Object.keys(patch).length === 0) {
        throw new Error("Nothing to update: send name, color or position");
      }

      const updated = await taskGroupRepository.update(group, patch);

      // Renaming the lane renames it on every card parked in it.
      if (patch.name !== undefined) {
        const status = statusForGroup(updated.name);
        if (status) {
          await taskGroupRepository.syncTaskStatuses(updated.id, status);
        }
      }

      return updated;
    } catch (error: any) {
      if (error?.name === "SequelizeUniqueConstraintError") {
        throw new Error("A group with that name already exists");
      }
      throw error;
    }
  }

  public async deleteGroup(
    callerId: string,
    callerRole: string | undefined,
    id: string
  ) {
    try {
      if (!id) throw new Error("Group id is required");
      const group = await taskGroupRepository.findById(id);
      if (!group) throw new Error("Group not found");
      await resolveBoardOwner(callerId, callerRole, group.user_id);
      assertMutable(group, callerRole);

      // ON DELETE SET NULL clears group_id, but since 009 the group's NAME also
      // lives in tasks.status — left alone it matches no group lane (no group)
      // and no status lane (not a status), so the card would render nowhere.
      // The pre-group status was overwritten when the card was parked, so there
      // is nothing to restore: fall back to ORPHAN_FALLBACK_STATUS.
      if (statusForGroup(group.name) === group.name.trim()) {
        await taskGroupRepository.syncTaskStatuses(
          group.id,
          ORPHAN_FALLBACK_STATUS
        );
      }

      return await taskGroupRepository.remove(group);
    } catch (error) {
      throw error;
    }
  }
}
