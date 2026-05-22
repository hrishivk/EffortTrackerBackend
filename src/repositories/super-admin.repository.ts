import { Domain } from "../connection/models/domain";
import { DomainAssignment } from "../connection/models/domain_assignment";
import { Project } from "../connection/models/project";
import { ProjectMember } from "../connection/models/project_member";
import { User } from "../connection/models/user";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { col, fn, literal, Op, Sequelize, where } from "sequelize";
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
              { client_department: currentUser.department },
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
      return await Domain.findAll({
        include: [
          {
            model: User,
            as: "creator",
            attributes: ["id", "fullName"],
          },
          {
            model: User,
            as: "assignedUsers",
            attributes: ["id", "fullName"],
            through: { attributes: [] },
          },
        ],
        order: [["created_at", "DESC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  public async listDomainsForUser(userId: string) {
    try {
      return await Domain.findAll({
        include: [
          {
            model: User,
            as: "creator",
            attributes: ["id", "fullName"],
          },
          {
            model: User,
            as: "assignedUsers",
            attributes: ["id", "fullName"],
            through: { attributes: [] },
            required: true,
            where: { id: userId },
          },
        ],
        order: [["created_at", "DESC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  public async assignDomainMembers(domain_id: string, user_ids: string[]) {
    try {
      if (!user_ids.length) return;
      const records = user_ids.map((user_id) => ({ domain_id, user_id }));
      await DomainAssignment.bulkCreate(records, { ignoreDuplicates: true });
    } catch (error) {
      throw error;
    }
  }
  public async listAllProjects(userId?: string, userRole?: string, search?: string, page?: number, limit?: number) {
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
              { client_department: currentUser.department },
            ],
          };
        }
      }

      console.log("Final whereClause:", JSON.stringify(whereClause, null, 2));

      const queryOptions: any = {
        where: whereClause,
        include: includeClause,
        order: [["createdAt", "DESC"]],
        distinct: true,
      };

      if (page && limit) {
        queryOptions.offset = (page - 1) * limit;
        queryOptions.limit = limit;
      }

      const { count, rows: projects } = await Project.findAndCountAll(queryOptions);

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

      const data = projects.map((p: any) => {
        const plain = p.get({ plain: true });
        const tasks = taskMap.get(plain.id) || { total: 0, completed: 0 };
        const progress = tasks.total === 0 ? 0 : Math.round((tasks.completed / tasks.total) * 100);

        return {
          id: plain.id,
          name: plain.name,
          description: plain.description,
          dueDate: plain.end_date,
          startDate: plain.start_date,
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

      return {
        data,
        totalPages: limit ? Math.ceil(count / limit) : 1,
      };
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
        role: { [Op.ne]: "SP" },
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
      if (role && role.toUpperCase() !== "SP") {
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
      const user = await User.findOne({
        where: { id },
        attributes: { exclude: ["password"] },
        include: [
          {
            model: User,
            as: "manager",
            attributes: ["id", "fullName", "job_title"],
          },
          {
            model: Project,
            as: "projects",
            attributes: ["id", "name"],
            through: { attributes: [] },
          },
        ],
      });

      if (!user) return null;

      // Fetch department members (same department, excluding self)
      let departmentMembers: { count: number; members: any[] } = { count: 0, members: [] };
      if (user.department) {
        const members = await User.findAll({
          where: {
            department: user.department,
            id: { [Op.ne]: id },
          },
          attributes: ["id", "fullName"],
        });
        departmentMembers = {
          count: members.length,
          members: members.map((m: any) => ({ id: m.id, fullName: m.fullName })),
        };
      }

      return { user, departmentMembers };
    } catch (error) {
      throw error;
    }
  }
  public async fetchTaskCount(role: string, date: string) {
    try {
      const statusCounts: any = await Task.findAll({
        attributes: [
          "status",
          [Sequelize.fn("COUNT", Sequelize.col("status")), "count"],
        ],
        group: ["status"],
        raw: true,
      });

      const counts: Record<string, number> = {
        yet_to_start: 0,
        in_progress: 0,
        completed: 0,
        blocked: 0,
      };
      let totalTasks = 0;
      statusCounts.forEach((row: any) => {
        const c = Number(row.count) || 0;
        counts[row.status] = c;
        totalTasks += c;
      });

      // Calculate total hours from completed tasks that have start_time and end_time
      const hoursResult: any = await Task.findAll({
        attributes: [
          [
            fn(
              "COALESCE",
              fn(
                "SUM",
                literal(
                  `EXTRACT(EPOCH FROM ("end_time" - "start_time")) / 3600`
                )
              ),
              0
            ),
            "total_hours",
          ],
        ],
        where: {
          start_time: { [Op.ne]: null },
          end_time: { [Op.ne]: null },
        },
        raw: true,
      });

      const totalDecimalHours = Number(hoursResult[0]?.total_hours) || 0;
      const hours = Math.floor(totalDecimalHours);
      const minutes = Math.round((totalDecimalHours - hours) * 60);
      const totalHours = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

      return {
        totalTasks,
        yetToStart: counts.yet_to_start,
        inProgress: counts.in_progress,
        completed: counts.completed,
        blocked: counts.blocked,
        totalHours,
      };
    } catch (error) {
      throw error;
    }
  }

  public async fetchTaskCompletionTrend() {
    try {
      const results: any = await Task.findAll({
        attributes: [
          [fn("TO_CHAR", col("updated_at"), "Mon"), "month"],
          [fn("EXTRACT", literal("MONTH FROM updated_at")), "month_num"],
          [fn("EXTRACT", literal("YEAR FROM updated_at")), "year"],
          [fn("COUNT", col("id")), "completed"],
        ],
        where: { status: "completed" },
        group: [
          fn("TO_CHAR", col("updated_at"), "Mon"),
          fn("EXTRACT", literal("MONTH FROM updated_at")),
          fn("EXTRACT", literal("YEAR FROM updated_at")),
        ],
        order: [
          [fn("EXTRACT", literal("YEAR FROM updated_at")), "ASC"],
          [fn("EXTRACT", literal("MONTH FROM updated_at")), "ASC"],
        ],
        raw: true,
      });

      return results.map((r: any) => ({
        month: r.month?.trim(),
        completed: Number(r.completed) || 0,
      }));
    } catch (error) {
      throw error;
    }
  }

  public async fetchTeamPerformance() {
    try {
      // Get all non-SP, non-blocked users
      const users = await User.findAll({
        where: {
          role: { [Op.ne]: "SP" },
          isBlocked: false,
        },
        attributes: ["id", "fullName"],
        raw: true,
      });

      if (users.length === 0) return [];

      const userIds = users.map((u: any) => u.id);

      // Get assigned project count per user
      const projectCounts: any = await ProjectMember.findAll({
        attributes: [
          "user_id",
          [fn("COUNT", fn("DISTINCT", col("project_id"))), "project_count"],
        ],
        where: { user_id: { [Op.in]: userIds } },
        group: ["user_id"],
        raw: true,
      });
      const projectMap = new Map(
        projectCounts.map((r: any) => [r.user_id, Number(r.project_count) || 0])
      );

      // Get task stats per user via daily_task_logs -> tasks
      const taskStats: any = await Task.findAll({
        attributes: [
          [col("dailyLog.assigned_to"), "user_id"],
          "status",
          [fn("COUNT", col("Task.id")), "count"],
        ],
        include: [
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: [],
            where: { assigned_to: { [Op.in]: userIds } },
          },
        ],
        group: [col("dailyLog.assigned_to"), "Task.status"],
        raw: true,
      });

      // Build per-user stats
      const userStatsMap = new Map<
        string,
        { yetToStart: number; inProgress: number; completed: number; blocked: number; total: number }
      >();
      taskStats.forEach((row: any) => {
        const uid = row.user_id;
        if (!userStatsMap.has(uid)) {
          userStatsMap.set(uid, { yetToStart: 0, inProgress: 0, completed: 0, blocked: 0, total: 0 });
        }
        const s = userStatsMap.get(uid)!;
        const c = Number(row.count) || 0;
        s.total += c;
        if (row.status === "yet_to_start") s.yetToStart += c;
        else if (row.status === "in_progress") s.inProgress += c;
        else if (row.status === "completed") s.completed += c;
        else if (row.status === "blocked") s.blocked += c;
      });

      // Get total hours per user from tasks with start/end times
      const hoursStats: any = await Task.findAll({
        attributes: [
          [col("dailyLog.assigned_to"), "user_id"],
          [
            fn(
              "COALESCE",
              fn("SUM", literal(`EXTRACT(EPOCH FROM ("Task"."end_time" - "Task"."start_time")) / 3600`)),
              0
            ),
            "total_hours",
          ],
        ],
        include: [
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: [],
            where: { assigned_to: { [Op.in]: userIds } },
          },
        ],
        where: {
          start_time: { [Op.ne]: null },
          end_time: { [Op.ne]: null },
        },
        group: [col("dailyLog.assigned_to")],
        raw: true,
      });
      const hoursMap = new Map(
        hoursStats.map((r: any) => [r.user_id, Number(r.total_hours) || 0])
      );

      return users.map((u: any) => {
        const stats = userStatsMap.get(u.id) || {
          yetToStart: 0, inProgress: 0, completed: 0, blocked: 0, total: 0,
        };
        const decHours = Number(hoursMap.get(u.id) || 0);
        const hrs = Math.floor(decHours);
        const mins = Math.round((decHours - hrs) * 60) as number;
        const totalHours = `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
        const efficiency = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100);

        return {
          userId: u.id,
          name: u.fullName,
          assignedProjects: projectMap.get(u.id) || 0,
          yetToStart: stats.yetToStart,
          inProgress: stats.inProgress,
          completed: stats.completed,
          totalHours,
          efficiency,
        };
      });
    } catch (error) {
      throw error;
    }
  }

  public async fetchRecentActivity(limit: number = 10) {
    try {
      const recentTasks: any = await Task.findAll({
        attributes: ["id", "description", "status", "updated_at"],
        include: [
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["assigned_to"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["fullName"],
              },
            ],
          },
        ],
        order: [["updated_at", "DESC"]],
        limit,
      });

      return recentTasks.map((t: any) => {
        const plain = t.get({ plain: true });
        return {
          user: plain.dailyLog?.assignedUser?.fullName || "Unknown",
          action: plain.status === "completed"
            ? "completed"
            : plain.status === "in_progress"
              ? "started working on"
              : plain.status === "blocked"
                ? "marked as blocked"
                : "updated",
          task: plain.description,
          time: plain.updated_at,
        };
      });
    } catch (error) {
      throw error;
    }
  }

  public async fetchUpcomingDeadlines(limit: number = 10) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks: any = await Task.findAll({
        attributes: ["id", "description", "end_time"],
        where: {
          end_time: { [Op.gte]: today },
          status: { [Op.ne]: "completed" },
        },
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["name"],
          },
        ],
        order: [["end_time", "ASC"]],
        limit,
        raw: false,
      });

      return tasks.map((t: any) => {
        const plain = t.get({ plain: true });
        const dueDate = new Date(plain.end_time);
        const diffMs = dueDate.getTime() - today.getTime();
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        return {
          task: plain.description,
          project: plain.project?.name || "Unassigned",
          dueDate: dueDate.toISOString().split("T")[0],
          daysLeft,
        };
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
      return await Domain.findOne({ where: { id} });
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
        require_password_change,
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
      if (require_password_change !== undefined) updateLoad.require_password_change = require_password_change;

      await user.update(updateLoad);
      return user;
    } catch (error) {
      throw error;
    }
  }

}
