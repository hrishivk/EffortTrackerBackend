import { Notification } from "../connection/models/notification";
import { Op } from "sequelize";

export class NotificationRepository {
  public async create(data: {
    user_id: string;
    type: string;
    title: string;
    message: string;
    reference_id?: string;
  }) {
    try {
      return await Notification.create({
        user_id: data.user_id,
        type: data.type,
        title: data.title,
        message: data.message,
        reference_id: data.reference_id || null,
      });
    } catch (error) {
      throw error;
    }
  }

  // One notification per recipient, de-duplicated, with blank ids dropped.
  //
  // Fan-out exists because three of the four room shared-task events go to a
  // SET of people (everyone on the task, minus the author) rather than to one.
  // De-duplication matters there: a person who owns the main task AND a subtask
  // appears twice in the naive recipient list and would get the same comment
  // notification twice.
  //
  // bulkCreate rather than a loop: the recipient list is the whole room, so a
  // loop is one round trip per member.
  public async createMany(
    user_ids: string[],
    data: {
      type: string;
      title: string;
      message: string;
      reference_id?: string;
    }
  ) {
    try {
      const recipients = [...new Set((user_ids ?? []).filter(Boolean))];
      if (!recipients.length) return [];
      return await Notification.bulkCreate(
        recipients.map((user_id) => ({
          user_id,
          type: data.type,
          title: data.title,
          message: data.message,
          reference_id: data.reference_id || null,
        }))
      );
    } catch (error) {
      throw error;
    }
  }

  public async getByUserId(
    user_id: string,
    page: number = 1,
    limit: number = 20
  ) {
    try {
      const offset = (page - 1) * limit;
      const { count, rows } = await Notification.findAndCountAll({
        where: { user_id },
        order: [["created_at", "DESC"]],
        offset,
        limit,
      });

      return {
        data: rows,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  public async getUnreadCount(user_id: string) {
    try {
      return await Notification.count({
        where: { user_id, is_read: false },
      });
    } catch (error) {
      throw error;
    }
  }

  public async markAsRead(notification_id: string, user_id: string) {
    try {
      const notification = await Notification.findByPk(notification_id);
      if (!notification) throw new Error("Notification not found");
      if (notification.user_id !== user_id)
        throw new Error("Not authorized");

      notification.is_read = true;
      await notification.save();
      return notification;
    } catch (error) {
      throw error;
    }
  }

  public async markAllAsRead(user_id: string) {
    try {
      await Notification.update(
        { is_read: true },
        { where: { user_id, is_read: false } }
      );
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}
