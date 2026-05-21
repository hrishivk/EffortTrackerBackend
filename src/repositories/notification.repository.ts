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
