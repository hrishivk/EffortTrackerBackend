import { TaskGroup } from "../connection/models/task_group";
import { Op } from "sequelize";
import { statusForGroup } from "./user.repository";
import { Task } from "../connection/models/tasks";
import { TaskGroupInput, TaskGroupPatch } from "../types/task.types";

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

  // A user may not create a private lane whose name collides with a shared one,
  // or the board would draw two lanes with the same label.
  public async findSharedByName(name: string) {
    try {
      return await TaskGroup.findOne({ where: { is_shared: true, name } });
    } catch (error) {
      throw error;
    }
  }

  // The lane visible to this user whose name stands for a given status, e.g.
  // "Yet to Start" for yet_to_start. Used by the carry-over to keep a card's
  // lane in step with the status it lands on.
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

  // Appends to the end of the user's lanes when no position is supplied.
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

  // Since 009 a grouped task carries the group's name in status, so a rename
  // has to follow through or those tasks keep the old name and drift out of the
  // filter ("production" vs "Production").
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

  // The tasks.group_id FK is ON DELETE SET NULL, so the group's cards fall back
  // to their status lane on their own — nothing to clean up here.
  public async remove(group: TaskGroup) {
    try {
      await group.destroy();
      return { id: group.id };
    } catch (error) {
      throw error;
    }
  }
}
