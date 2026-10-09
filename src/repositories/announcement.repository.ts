import { Op, Transaction } from "sequelize";
import { Database } from "../connection/db/dbConnection";
import { Announcement } from "../connection/models/announcement";
import { Notification } from "../connection/models/notification";
import { User } from "../connection/models/user";

// Everyone who gets the bell notification. SP is left out: they sent it.
const RECIPIENT_ROLES = ["AM", "MG", "USER", "DEVLOPER"];
export class AnnouncementRepository {
  public async latest() {
    try {
      return await Announcement.findOne({
        attributes: ["id", "version", "title", "message", "created_at"],
        order: [["created_at", "DESC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  // The row and its notifications in one transaction, so a failure part-way
  // leaves nothing behind. Every call sends: the same version can be
  // announced again at any time, and each send is its own row.
  public async createAndNotify(data: {
    version: string;
    title: string;
    message: string | null;
    created_by: string;
  }): Promise<{ announcement: Announcement; notified: number }> {
    const sequelize = Database.getSequelize();
    try {
      return await sequelize.transaction(async (t: Transaction) => {
        const announcement = await Announcement.create(data, { transaction: t });

        const recipients = await User.findAll({
          where: { isBlocked: false, role: { [Op.in]: RECIPIENT_ROLES } },
          attributes: ["id"],
          transaction: t,
        });

        // bulkCreate rather than a loop: this is every user in the system.
        if (recipients.length) {
          await Notification.bulkCreate(
            recipients.map((u: any) => ({
              user_id: u.id,
              type: "release_announcement",
              title: data.title,
              message: `See what's new in version ${data.version}`,
              reference_id: announcement.id,
            })),
            { transaction: t }
          );
        }

        return { announcement, notified: recipients.length };
      });
    } catch (error) {
      throw error;
    }
  }
}
