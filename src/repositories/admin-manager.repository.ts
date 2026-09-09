
import { Op } from 'sequelize';
import { Domain } from '../connection/models/domain';
import { Project } from '../connection/models/project';
import { User } from '../connection/models/user';
import { superAdminRepository } from './super-admin.repository';

const SuperAdminRepository = new superAdminRepository();

export class adminManagerRepository {
  public async listAllusers(id: string) {
    try {
      // Own team + shared users assigned to one of this manager's domains
      const domainPeerIds = await SuperAdminRepository.getDomainPeerUserIds(id);
      return await User.findAll({
        order: [["createdAt", "DESC"]],
        where: {
          [Op.or]: [
            { manager_id: id },
            { is_shared: true, id: { [Op.in]: domainPeerIds } },
          ],
        },
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
