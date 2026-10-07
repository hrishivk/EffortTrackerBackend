import { TaskGroup } from "../connection/models/task_group";
import { Op } from "sequelize";
import { statusForGroup } from "./user.repository";
import { Task } from "../connection/models/tasks";
import { User } from "../connection/models/user";
import { superAdminRepository } from "./super-admin.repository";
import { TaskGroupInput, TaskGroupPatch } from "../types/task.types";

const SuperAdminRepository = new superAdminRepository();

export class TaskGroupRepository {
  // Ordered the way the board draws the lanes. Returns the shared lanes every
  // board shows plus the ones this particular board owns.
  public async listByUser(user_id: string) {
    try {
      return await TaskGroup.findAll({
        where: { [Op.or]: [{ is_shared: true }, { user_id }] },
        order: [
          ["position", "ASC"],
          ["created_at", "ASC"],
        ],
      });
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

  public async findVisibleLaneForStatus(user_id: string, status: string) {
    try {
      const groups = await TaskGroup.findAll({
        where: { [Op.or]: [{ is_shared: true }, { user_id }] },
        order: [["position", "ASC"]],
      });
      return groups.find((g) => statusForGroup(g.name) === status) ?? null;
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
        name: data.name,
        color: data.color ?? null,
        position:
          data.position ?? (await this.nextPosition(data.user_id)),
      });
    } catch (error) {
      throw error;
    }
  }

  public async syncTaskStatuses(group_id: string, status: string) {
    try {
      const [count] = await Task.update(
        { status, updated_at: new Date() },
        { where: { group_id } }
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
