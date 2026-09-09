import { TaskGroupRepository } from "../repositories/task-group.repository";
import { TaskGroupPatch } from "../types/task.types";
import { Role } from "../Enums/Role";
import { statusForGroup } from "../repositories/user.repository";

const taskGroupRepository = new TaskGroupRepository();

// Only SP and AM can pull up someone else's board — the same rule
// findDailyLogs applies to /task-list, so the groups a board returns always
// match the group_id values its tasks carry.
const CROSS_BOARD_ROLES: string[] = [Role.SuperAdmin, Role.Admin];

// Where a card lands when the group it was parked in is deleted. Its original
// status is unrecoverable (overwritten on the drop), so this is a choice, not a
// restore: visible-but-wrong beats invisible.
const ORPHAN_FALLBACK_STATUS = "yet_to_start";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const resolveBoardOwner = (
  callerId: string,
  callerRole: string | undefined,
  assigned_to?: string
): string => {
  if (!assigned_to || assigned_to === callerId) return callerId;
  if (!callerRole || !CROSS_BOARD_ROLES.includes(callerRole)) {
    throw new Error("Not authorized to view this board's groups");
  }
  return assigned_to;
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
      const owner = resolveBoardOwner(callerId, callerRole, assigned_to);
      return await taskGroupRepository.listByUser(owner);
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
      const owner = resolveBoardOwner(callerId, callerRole, data.assigned_to);
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
      resolveBoardOwner(callerId, callerRole, group.user_id);

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
      resolveBoardOwner(callerId, callerRole, group.user_id);

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
