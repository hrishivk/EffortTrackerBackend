
import { Domain } from '../connection/models/domain';
import { Project } from '../connection/models/project';
import { User } from '../connection/models/user';

export class adminManagerRepository {
  public async listAllusers(id: string) {
    try {
       return await User.findAll({
        order: [["createdAt", "DESC"]],
        where: { manager_id: id },
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
}
