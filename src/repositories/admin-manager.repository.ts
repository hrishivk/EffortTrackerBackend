
import { Op } from 'sequelize';
import { Domain } from '../connection/models/domain';
import { Project } from '../connection/models/project';
import { User } from '../connection/models/user';

export class adminManagerRepository {
  public async listAllusers(id: string) {
    try {
       return await User.findAll({
        order: [["createdAt", "DESC"]],
        // Own team + shared users (visible to every manager)
        where: { [Op.or]: [{ manager_id: id }, { is_shared: true }] },
        include: [
          {
            model: Project,
            as: "projects",
            through: { attributes: ["role"] },
            include: [{ model: Domain, as: "domain" }],
          },
        ],
      });
    } catch (error) {
      throw error;
    }
  }

  public async listTeamMembersForFilter(manager_id: string) {
    try {
      return await User.findAll({
        where: {
          manager_id,
          role: { [Op.in]: ["USER", "DEVLOPER"] },
          isBlocked: false,
        },
        attributes: ["id", "fullName", "employee_id", "role"],
        order: [["fullName", "ASC"]],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }
}
