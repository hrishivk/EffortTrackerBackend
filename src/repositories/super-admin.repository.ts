import { Domain } from "../connection/models/domain";
import { Project } from "../connection/models/project";
import { ProjectMember } from "../connection/models/project_member";
import { User } from "../connection/models/user";
import { col, fn, Op, Sequelize, where } from "sequelize";
import { AddUserDTO } from "../types/user.types";
import { Task } from "../connection/models/tasks";


export class superAdminRepository {
  public async getProjectStats(userId?: string, userRole?: string) {
    try {
      // Build project filter based on role (same logic as listAllProjects)
      let projectWhereClause: any = {};

      if (userRole === "AM" && userId) {
        // 1. Projects directly assigned to this AM
        const myDirectProjects = await ProjectMember.findAll({
          where: { user_id: userId },
          attributes: ["project_id"],
          raw: true,
        });
        const myDirectProjectIds = myDirectProjects.map((pm: any) => pm.project_id);

        // 2. Projects where AM's team members are assigned
        const myTeam = await User.findAll({
          where: { manager_id: userId },
          attributes: ["id"],
          raw: true,
        });
        const myTeamIds = myTeam.map((u: any) => u.id);

        let myTeamProjectIds: string[] = [];
        if (myTeamIds.length > 0) {
          const teamProjects = await ProjectMember.findAll({
            where: { user_id: { [Op.in]: myTeamIds } },
            attributes: ["project_id"],
            raw: true,
          });
          myTeamProjectIds = teamProjects.map((pm: any) => pm.project_id);
        }

        const allAMs = await User.findAll({
          where: { role: "AM" },
          attributes: ["id"],
          raw: true,
        });
        const allAMIds = allAMs.map((u: any) => u.id);

        let projectsAssignedToAnyAM: string[] = [];
        if (allAMIds.length > 0) {
          const amAssignedProjects = await ProjectMember.findAll({
            where: { user_id: { [Op.in]: allAMIds } },
            attributes: ["project_id"],
            raw: true,
          });
          projectsAssignedToAnyAM = [...new Set(amAssignedProjects.map((pm: any) => pm.project_id))];
        }

        // AM sees: assigned projects + team projects + projects they created
        //        + SP-created projects not assigned to any AM
        const allMyProjectIds = [...new Set([...myDirectProjectIds, ...myTeamProjectIds])];
        projectWhereClause[Op.or] = [
          { id: { [Op.in]: allMyProjectIds } },
          { created_by: userId },
          {
            id: { [Op.notIn]: projectsAssignedToAnyAM },
            [Op.or]: [
              { created_by: null },
              { created_by: { [Op.notIn]: allAMIds } },
            ],
          },
        ];
      }
      // SP sees all — no filter needed

      // Category filter: AM/User only see projects matching their department
      if (userRole !== "SP" && userId) {
        const currentUser = await User.findByPk(userId, { attributes: ["department"], raw: true });
        if (currentUser?.department) {
          projectWhereClause = {
            [Op.and]: [
              projectWhereClause,
              { project_category: currentUser.department },
            ],
          };
        }
      }

      // Get filtered project IDs
      const filteredProjects = await Project.findAll({
        where: projectWhereClause,
        attributes: ["id", "status"],
        raw: true,
      });
      const filteredProjectIds = filteredProjects.map((p: any) => p.id);

      // Status counts from filtered projects
      const totalProjects = filteredProjects.length;
      const stats: Record<string, number> = {
        total: totalProjects,
        active: 0,
        on_hold: 0,
        paused: 0,
        completed: 0,
      };
      filteredProjects.forEach((p: any) => {
        if (stats.hasOwnProperty(p.status)) {
          stats[p.status]++;
        }
      });

      // Active resources = unique non-blocked users in filtered active projects
      const activeProjectIds = filteredProjects.filter((p: any) => p.status === "active").map((p: any) => p.id);
      let activeResources = 0;
      if (activeProjectIds.length > 0) {
        const activeMembers = await ProjectMember.findAll({
          where: { project_id: { [Op.in]: activeProjectIds } },
          attributes: ["user_id"],
          raw: true,
        });
        const uniqueUserIds = [...new Set(activeMembers.map((m: any) => m.user_id))];
        if (uniqueUserIds.length > 0) {
          activeResources = await User.count({
            where: {
              id: { [Op.in]: uniqueUserIds },
              isBlocked: false,
            },
          });
        }
      }

      // Total completion from tasks of filtered projects only
      let totalCompletion = 0;
      if (filteredProjectIds.length > 0) {
        const taskStats: any = await Task.findAll({
          attributes: [
            [fn("COUNT", col("id")), "total_tasks"],
            [fn("SUM", Sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), "completed_tasks"],
          ],
          where: { project_id: { [Op.in]: filteredProjectIds } },
          raw: true,
        });
        const totalTasks = Number(taskStats[0]?.total_tasks) || 0;
        const completedTasks = Number(taskStats[0]?.completed_tasks) || 0;
        totalCompletion = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
      }

      return {
        projects: stats,
        activeResources,
        totalCompletion,
      };
    } catch (error) {
      throw error;
    }
  }

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
  public async listAllProjects(userId?: string, userRole?: string, search?: string) {
    try {
      const includeClause: any[] = [
        {
          model: User,
          as: "members",
          attributes: ["id", "fullName"],
          through: { attributes: [] },
          where: { role: { [Op.ne]: "SP" } },
          required: false,
        },
        {
          model: Domain,
          as: "domain",
          attributes: ["id", "name"],
        },
      ];

      let whereClause: any = {};

      if (search && search.trim()) {
        whereClause.name = { [Op.iLike]: `%${search.trim()}%` };
      }

      if (userRole === "AM" && userId) {
        // 1. Projects directly assigned to this AM
        const myDirectProjects = await ProjectMember.findAll({
          where: { user_id: userId },
          attributes: ["project_id"],
          raw: true,
        });
        const myDirectProjectIds = myDirectProjects.map((pm: any) => pm.project_id);

        // 2. Projects where AM's team members are assigned
        const myTeam = await User.findAll({
          where: { manager_id: userId },
          attributes: ["id"],
          raw: true,
        });
        const myTeamIds = myTeam.map((u: any) => u.id);

        let myTeamProjectIds: string[] = [];
        if (myTeamIds.length > 0) {
          const teamProjects = await ProjectMember.findAll({
            where: { user_id: { [Op.in]: myTeamIds } },
            attributes: ["project_id"],
            raw: true,
          });
          myTeamProjectIds = teamProjects.map((pm: any) => pm.project_id);
        }

        // 3. Projects not assigned to any AM (SP-created unassigned projects visible to all AMs)
        const allAMs = await User.findAll({
          where: { role: "AM" },
          attributes: ["id"],
          raw: true,
        });
        const allAMIds = allAMs.map((u: any) => u.id);

        let projectsAssignedToAnyAM: string[] = [];
        if (allAMIds.length > 0) {
          const amAssignedProjects = await ProjectMember.findAll({
            where: { user_id: { [Op.in]: allAMIds } },
            attributes: ["project_id"],
            raw: true,
          });
          projectsAssignedToAnyAM = [...new Set(amAssignedProjects.map((pm: any) => pm.project_id))];
        }

        // AM sees: assigned projects + team projects + projects they created
        //        + SP-created projects not assigned to any AM
        const allMyProjectIds = [...new Set([...myDirectProjectIds, ...myTeamProjectIds])];
        whereClause[Op.or] = [
          { id: { [Op.in]: allMyProjectIds } },
          { created_by: userId },
          {
            id: { [Op.notIn]: projectsAssignedToAnyAM },
            [Op.or]: [
              { created_by: null },
              { created_by: { [Op.notIn]: allAMIds } },
            ],
          },
        ];
      } else if (userRole !== "SP" && userId) {
        // USER/DEVLOPER see only assigned + created projects
        const memberProjects = await ProjectMember.findAll({
          where: { user_id: userId },
          attributes: ["project_id"],
          raw: true,
        });
        const projectIds = memberProjects.map((pm: any) => pm.project_id);
        whereClause[Op.or] = [
          { id: { [Op.in]: projectIds } },
          { created_by: userId },
        ];
      }

      // Category filter: AM/User only see projects matching their department
      if (userRole !== "SP" && userId) {
        const currentUser = await User.findByPk(userId, { attributes: ["department"], raw: true });
        if (currentUser?.department) {
          whereClause = {
            [Op.and]: [
              whereClause,
              { project_category: currentUser.department },
            ],
          };
        }
      }

      console.log("Final whereClause:", JSON.stringify(whereClause, null, 2));

      const projects = await Project.findAll({
        where: whereClause,
        include: includeClause,
        order: [["createdAt", "DESC"]],
      });

      // Calculate progress from tasks for each project
      const projectIds = projects.map((p: any) => p.id);
      let taskCounts: any[] = [];
      if (projectIds.length > 0) {
        taskCounts = await Task.findAll({
          attributes: [
            "project_id",
            [fn("COUNT", col("id")), "total_tasks"],
            [fn("SUM", Sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), "completed_tasks"],
          ],
          where: { project_id: { [Op.in]: projectIds } },
          group: ["project_id"],
          raw: true,
        });
      }

      const taskMap = new Map<string, { total: number; completed: number }>();
      taskCounts.forEach((tc: any) => {
        taskMap.set(tc.project_id, {
          total: Number(tc.total_tasks) || 0,
          completed: Number(tc.completed_tasks) || 0,
        });
      });

      return projects.map((p: any) => {
        const plain = p.get({ plain: true });
        const tasks = taskMap.get(plain.id) || { total: 0, completed: 0 };
        const progress = tasks.total === 0 ? 0 : Math.round((tasks.completed / tasks.total) * 100);

        return {
          id: plain.id,
          name: plain.name,
          description: plain.description,
          dueDate: plain.end_date,
          startDate: plain.start_date,
          projectCategory: plain.project_category || null,
          clientDepartment: plain.client_department || null,
          status: plain.status?.toUpperCase().replace("_", " ") || "ACTIVE",
          progress,
          totalTasks: tasks.total,
          completedTasks: tasks.completed,
          domain: plain.domain || null,
          teamAssigned: (plain.members || []).map((m: any) => ({
            id: m.id,
            name: m.fullName,
            avatar: "",
          })),
        };
      });
    } catch (error) {
      throw error;
    }
  }
  public async listAllUsers(filters: {
    search?: string;
    role?: string;
    isBlocked?: string;
    project_id?: string;
    manager_id?: string;
    page: number;
    limit: number;
  }) {
    try {
      const { search, role, isBlocked, project_id, manager_id, page, limit } = filters;
      const whereClause: any = {
        id: { [Op.ne]: "2f3xfkSN5zHdYa5" },
      };

      if (manager_id) {
        whereClause.manager_id = manager_id;
      }

      if (search) {
        whereClause[Op.or] = [
          { fullName: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
        ];
      }
      if (role) {
        whereClause.role = role.toUpperCase();
      }

      if (isBlocked !== undefined) {
        whereClause.isBlocked = isBlocked === "true";
      }

      const offset = (page - 1) * limit;

      const includeClause: any[] = [
        {
          model: Project,
          as: "projects",
          through: { attributes: ["role"] },
          include: [
            {
              model: Domain,
              as: "domain",
            },
          ],
        },
      ];

      if (project_id) {
        includeClause[0].where = { id: project_id };
        includeClause[0].required = true;
      }

      const { count, rows } = await User.findAndCountAll({
        where: whereClause,
        include: includeClause,
        limit,
        offset,
        order: [["createdAt", "DESC"]],
        distinct: true,
      });

      const users = rows.map((u) => u.get({ plain: true }));

      return {
        users,
        totalRecords: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
      };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async getDomainHierarchy() {
    const domains = await Domain.findAll({
      raw: true,
    });
    const projects = await Project.findAll({
      attributes: [
        "id",
        "name",
        "domain_id",
        "status",
        "progress",
        [fn("COUNT", fn("DISTINCT", col("projectMembers.user_id"))), "members"],
        [fn("COUNT", fn("DISTINCT", col("tasks.id"))), "tasks"],
      ],
      include: [
        {
          model: ProjectMember,
          as: "projectMembers",
          attributes: [],
        },
        {
          model: Task,
          as: "tasks",
          attributes: [],
        },
      ],
      group: ["Project.id"],
      raw: true,
    });

    const result = domains.map((domain: any) => {
      const domainProjects = projects
        .filter((p: any) => p.domain_id === domain.id)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          progress: Number(p.progress) || 0,
          members: Number(p.members) || 0,
          tasks: Number(p.tasks) || 0,
        }));

      return {
        id: domain.id,
        name: domain.name,
        created: domain.created_at,
        projects: domainProjects,
      };
    });

    return result;
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
      console.log(error);
      throw error;
    }
  }
  public async unBlockUser(id: string) {
    try {
      const userId = parseInt(id, 10);

      const [affectedRows] = await User.update(
        { isBlocked: false },
        { where: { id: userId } },
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
        { where: { id: userId } },
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

  public async updateProjectStatus(id: string, status: "active" | "on_hold" | "paused" | "completed") {
    try {
      const project = await Project.findByPk(id);
      if (!project) throw new Error("Project not found");
      await project.update({ status });
      return project;
    } catch (error) {
      throw error;
    }
  }

  public async findProjectById(id: string) {
    try {
      return await Project.findByPk(id);
    } catch (error) {
      throw error;
    }
  }

  public async findProjectByName(name: string, excludeId?: string) {
    try {
      const where: any = { name };
      if (excludeId) {
        where.id = { [Op.ne]: excludeId };
      }
      return await Project.findOne({ where });
    } catch (error) {
      throw error;
    }
  }

  public async updateProject(id: string, data: any) {
    try {
      const project = await Project.findByPk(id);
      if (!project) throw new Error("Project not found");
      await project.update(data);
      return project;
    } catch (error) {
      throw error;
    }
  }

  public async deleteProject(id: string) {
    try {
      const project = await Project.findByPk(id);
      if (!project) throw new Error("Project not found");
      await project.destroy();
      return { message: "Project deleted successfully" };
    } catch (error) {
      throw error;
    }
  }
  public async findDomainById(id: string) {
    try {
      return await Domain.findOne({ where: { id } });
    } catch (error) {
      throw error;
    }
  }

  public async findDomainByName(name: string) {
    try {
      return await Domain.findOne({ where: { name } });
    } catch (error) {
      throw error;
    }
  }

  public async updateDomain(id: string, data: { name?: string; description?: string }) {
    try {
      const domain = await Domain.findByPk(id);
      if (!domain) throw new Error("Domain not found");
      await domain.update(data);
      return domain;
    } catch (error) {
      throw error;
    }
  }

  public async deleteDomain(id: string) {
    try {
      const domain = await Domain.findByPk(id);
      if (!domain) throw new Error("Domain not found");
      await domain.destroy();
      return { message: "Domain deleted successfully" };
    } catch (error) {
      throw error;
    }
  }
  public async assignMembers(project_id: string, user_ids: string[]) {
    try {
      const project = await Project.findByPk(project_id);
      if (!project) throw new Error("Project not found");

      const records = user_ids.map((user_id) => ({ project_id, user_id }));
      await ProjectMember.bulkCreate(records, { ignoreDuplicates: true });

      return await this.getProjectMembers(project_id);
    } catch (error) {
      throw error;
    }
  }

  public async removeMembers(project_id: string, user_ids: string[]) {
    try {
      const removed = await ProjectMember.destroy({
        where: {
          project_id,
          user_id: { [Op.in]: user_ids },
        },
      });
      if (removed === 0) throw new Error("No members found to remove");
      return await this.getProjectMembers(project_id);
    } catch (error) {
      throw error;
    }
  }

  public async getProjectMembers(project_id: string) {
    try {
      const project = await Project.findByPk(project_id, {
        include: [
          {
            model: User,
            as: "members",
            attributes: ["id", "fullName", "email", "role"],
            through: { attributes: [] },
          },
        ],
      });
      if (!project) throw new Error("Project not found");
      const plain: any = project.get({ plain: true });
      return (plain.members || []).map((m: any) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.email,
        role: m.role,
      }));
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
  public async findUserByEmployeeId(employee_id: string) {
    try {
      return await User.findOne({ where: { employee_id } });
    } catch (error) {
      throw error;
    }
  }

  public async editUser(data: AddUserDTO) {
    try {
      const {
        id, fullName, email, role, manager_id,
        job_title, employee_id, contact_number, date_of_birth,
        blood_group, department, work_schedule, joining_date,
        project_category, require_password_change,
      } = data;

      const user = await User.findByPk(id);
      if (!user) throw new Error("User not found");

      const updateLoad: any = {};
      if (fullName !== undefined) updateLoad.fullName = fullName;
      if (email !== undefined) updateLoad.email = email;
      if (role !== undefined) updateLoad.role = role;
      if (manager_id !== undefined) updateLoad.manager_id = manager_id;
      if (job_title !== undefined) updateLoad.job_title = job_title;
      if (employee_id !== undefined) updateLoad.employee_id = employee_id;
      if (contact_number !== undefined) updateLoad.contact_number = contact_number;
      if (date_of_birth !== undefined) updateLoad.date_of_birth = date_of_birth;
      if (blood_group !== undefined) updateLoad.blood_group = blood_group;
      if (department !== undefined) updateLoad.department = department;
      if (work_schedule !== undefined) updateLoad.work_schedule = work_schedule;
      if (joining_date !== undefined) updateLoad.joining_date = joining_date;
      if (project_category !== undefined) updateLoad.project_category = project_category;
      if (require_password_change !== undefined) updateLoad.require_password_change = require_password_change;

      await user.update(updateLoad);
      return user;
    } catch (error) {
      throw error;
    }
  }

}
