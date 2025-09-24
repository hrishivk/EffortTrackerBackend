import { Domain } from "../connection/models/domain";
import { Project } from "../connection/models/project";
import { User } from "../connection/models/user";
import { Op, Sequelize, where } from "sequelize";
import { AddUserDTO } from "../types/user.types";
import { envConfig } from "../config/env.config";
import { Task } from "../connection/models/tasks";

export class superAdminRepository {
  public async createDomain(data: any) {
    try {
      return await Domain.create(data);
    } catch (error) {
      throw error;
    }
  }
  public async listAllDomain() {
    try {
      return await Domain.findAll();
    } catch (error) {
      throw error;
    }
  }
  public async listAllProject() {
    try {
      return await Project.findAll();
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async listAllUsers() {
    try {
  const users = await User.findAll({
     where: {
    id: {
      [Op.ne]: "2f3xfkSN5zHdYa5",
    },
  },
  include: [
    {
      model: Project,
      include: [{ model: Domain }], 
    },
  ],
});

const plainUsers = users.map(u => u.get({ plain: true }));
console.log(plainUsers)
return plainUsers;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async getuser(id: string) {
    try {
      return await User.findOne({ where: { id: id } });
    } catch (error) {
      throw error;
    }
  }
  public async fetchTaskCount(role: string, date: string) {
    try {
      return await Task.findAll({
        attributes: [
          "status",
          [Sequelize.fn("COUNT", Sequelize.col("status")), "count"],
        ],
        group: ["status"],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }
  public async deleteuser(id: string) {
    try {
      return await User.destroy({ where: { id } });
    } catch (error) {
      console.log(error)
      throw error;
    }
  }
  public async unBlockUser(id: string) {
    try {
      const userId = parseInt(id, 10);
 
      const [affectedRows] = await User.update(
        { isBlocked: false },
        { where: { id: userId } }
      );
      return affectedRows;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async BlockUser(id: string) {
    try {
      const userId = parseInt(id, 10);
      const [affectedRows] = await User.update(
        { isBlocked: true },
        { where: { id: userId } }
      );

      console.log("affectedRows:", affectedRows);
      return affectedRows;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  public async createProject(data: any) {
    try {
      return await Project.create(data);
    } catch (error) {
      throw error;
    }
  }
  public async findOneDomain(data: any) {
    try {
      return await Domain.findOne({
        where: {
          id: data,
        },
      });
    } catch (error) {
      throw error;
    }
  }
  public async findOneProject(data: string) {
    try {
      return await Project.findOne({
        where: {
          name: data,
        },
      });
    } catch (error) {
      throw error;
    }
  }
  public async editUser(data: AddUserDTO) {
    try {
      const { id, fullName, email, role, projects, profileFilename } =
        data;

      const user = await User.findByPk(id);
      if (!user) throw new Error("User not found");
      const updateLoad: Partial<AddUserDTO> = {
        fullName,
        email,
        role,
        projects
      };

      await user.update(updateLoad);

      return user;
    } catch (error) {
      throw error;
    }
  }
}
