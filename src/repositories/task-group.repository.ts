import { TaskGroup } from "../connection/models/task_group";
import { TaskGroupHide } from "../connection/models/task_group_hide";
import { Op } from "sequelize";
import { statusForGroup } from "./user.repository";
import { Task } from "../connection/models/tasks";
import { User } from "../connection/models/user";
import { superAdminRepository } from "./super-admin.repository";
import { TaskGroupInput, TaskGroupPatch } from "../types/task.types";

const SuperAdminRepository = new superAdminRepository();

export class TaskGroupRepository {
  // Ordered the way the board draws the lanes. Returns the shared lanes every
  // board shows plus the ones this particular board owns: the user's own
  // board when room_id is null, else their lanes in that one room. Hidden
  // lanes included — the caller decides whether to draw them.
  public async listByUser(user_id: string, room_id: string | null = null) {
    try {
      const [groups, hiddenIds] = await Promise.all([
        TaskGroup.findAll({
          where: { [Op.or]: [{ is_shared: true }, { user_id, room_id }] },
          order: [
            ["position", "ASC"],
            ["created_at", "ASC"],
          ],
        }),
        this.hiddenGroupIds(user_id, room_id),
      ]);
      // `hidden` is per board: this user's hide rows for this board, plus the
      // lane-row flag from 027 for lanes hidden before per-board hides.
      return groups.map((group) => ({
        ...group.toJSON(),
        hidden: group.hidden || hiddenIds.has(group.id),
      }));
    } catch (error) {
      throw error;
    }
  }

  // The lanes one user has hidden on one board (room_id null = own board).
  public async hiddenGroupIds(
    user_id: string,
    room_id: string | null = null
  ): Promise<Set<string>> {
    try {
      const rows = await TaskGroupHide.findAll({
        where: { user_id, room_id },
        attributes: ["group_id"],
        raw: true,
      });
      return new Set(rows.map((row) => row.group_id));
    } catch (error) {
      throw error;
    }
  }

  // Hide or show one lane on one user's board. Idempotent both ways.
  public async setHiddenOnBoard(
    group_id: string,
    user_id: string,
    room_id: string | null,
    hidden: boolean
  ) {
    try {
      if (hidden) {
        await TaskGroupHide.findOrCreate({
          where: { group_id, user_id, room_id },
          defaults: { group_id, user_id, room_id },
        });
      } else {
        await TaskGroupHide.destroy({ where: { group_id, user_id, room_id } });
      }
    } catch (error) {
      throw error;
    }
  }


 
  public async listForBoards(userIds: string[]) {
    try {
      const owners = [...new Set((userIds ?? []).filter(Boolean))];
      const where: any = owners.length
        ? { [Op.or]: [{ is_shared: true }, { user_id: { [Op.in]: owners } }] }
        : { is_shared: true };
      return await TaskGroup.findAll({
        where,
        order: [
          ["position", "ASC"],
          ["created_at", "ASC"],
        ],
      });
    } catch (error) {
      throw error;
    }
  }
  
  public async isBoardManagedBy(
    manager_id: string,
    user_id: string
  ): Promise<boolean> {
    try {
      const user: any = await User.findByPk(user_id, {
        attributes: ["id", "manager_id", "is_shared"],
        raw: true,
      });
      if (!user) return false;
      if (user.manager_id === manager_id) return true;
      if (!user.is_shared) return false;
      const peers = await SuperAdminRepository.getDomainPeerUserIds(manager_id);
      return peers.includes(user_id);
    } catch (error) {
      throw error;
    }
  }


  public async findSharedByName(name: string) {
    try {
      return await TaskGroup.findOne({ where: { is_shared: true, name } });
    } catch (error) {
      throw error;
    }
  }

  // The lane a carried-over task lands in, on the board it belongs to. A
  // hidden lane is skipped: the card then sits in its status lane instead of
  // arriving somewhere the user has chosen not to look.
  public async findVisibleLaneForStatus(
    user_id: string,
    status: string,
    room_id: string | null = null
  ) {
    try {
      const [groups, hiddenIds] = await Promise.all([
        TaskGroup.findAll({
          where: {
            [Op.or]: [{ is_shared: true }, { user_id, room_id }],
            hidden: false,
          },
          order: [["position", "ASC"]],
        }),
        this.hiddenGroupIds(user_id, room_id),
      ]);
      return (
        groups.find(
          (g) => !hiddenIds.has(g.id) && statusForGroup(g.name) === status
        ) ?? null
      );
    } catch (error) {
      throw error;
    }
  }

  public async findById(id: string) {
    try {
      return await TaskGroup.findByPk(id);
    } catch (error) {
      throw error;
    }
  }


  public async nextPosition(user_id: string): Promise<number> {
    try {
      const max = await TaskGroup.max("position", { where: { user_id } });
      return typeof max === "number" ? max + 1 : 0;
    } catch (error) {
      throw error;
    }
  }

  public async create(data: TaskGroupInput) {
    try {
      return await TaskGroup.create({
        user_id: data.user_id,
        room_id: data.room_id ?? null,
        name: data.name,
        color: data.color ?? null,
        marks_status: data.marks_status ?? null,
        with_default_lanes: data.with_default_lanes ?? false,
        position:
          data.position ?? (await this.nextPosition(data.user_id)),
      });
    } catch (error) {
      throw error;
    }
  }

  // Only rows still carrying `fromStatus` (the group's name, as stored before
  // custom lanes kept the task's own status). A task parked with a real status
  // keeps it — overwriting that would complete or reopen work by accident.
  public async syncTaskStatuses(
    group_id: string,
    fromStatus: string,
    status: string
  ) {
    try {
      const [count] = await Task.update(
        { status, updated_at: new Date() },
        { where: { group_id, status: fromStatus } }
      );
      return count;
    } catch (error) {
      throw error;
    }
  }

  public async update(group: TaskGroup, patch: TaskGroupPatch) {
    try {
      if (patch.name !== undefined) group.name = patch.name;
      if (patch.color !== undefined) group.color = patch.color;
      if (patch.position !== undefined) group.position = patch.position;
      if (patch.marks_status !== undefined) group.marks_status = patch.marks_status;
      group.updated_at = new Date();
      await group.save();
      return group;
    } catch (error) {
      throw error;
    }
  }


  public async remove(group: TaskGroup) {
    try {
      await group.destroy();
      return { id: group.id };
    } catch (error) {
      throw error;
    }
  }
}
