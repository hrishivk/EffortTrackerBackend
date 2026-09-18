import { Domain } from "../connection/models/domain";
import { DomainAssignment } from "../connection/models/domain_assignment";
import { Project } from "../connection/models/project";
import { ProjectMember } from "../connection/models/project_member";
import { User } from "../connection/models/user";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { col, fn, literal, Op, Sequelize, where } from "sequelize";
import { AddUserDTO, EditUserDTO } from "../types/user.types";
import { Task } from "../connection/models/tasks";
import { NotificationRepository } from "./notification.repository";

const notificationRepo = new NotificationRepository();


export class superAdminRepository {
  // Which projects a caller is allowed to see, as a Sequelize `where`.
  // Returns null for SP - they see everything, so there is nothing to filter.
  //
  // Two layers, and the order matters:
  //   1. the ways IN - direct membership, their team's membership (AM only),
  //      projects they created, and for an AM the SP-created projects that no
  //      AM has picked up yet;
  //   2. the department gate, which narrows layer 1 but deliberately EXEMPTS
  //      projects the caller is directly assigned to.
  //
  // That exemption is the point. The gate used to be AND-ed over the whole
  // clause, so an AM assigned to a project outside their own department never
  // saw it - the assignment was a silent no-op. An explicit assignment now
  // always wins.
  private async buildProjectVisibilityWhere(
    userId?: string,
    userRole?: string,
  ): Promise<any | null> {
    if (userRole === "SP" || !userId) return null;

    // 1. Projects directly assigned to this user.
    const myDirect = await ProjectMember.findAll({
      where: { user_id: userId },
      attributes: ["project_id"],
      raw: true,
    });
    const myDirectProjectIds = [
      ...new Set(myDirect.map((pm: any) => String(pm.project_id))),
    ];

    const waysIn: any[] = [
      { id: { [Op.in]: myDirectProjectIds } },
      { created_by: userId },
    ];

    if (userRole === "AM") {
      // 2. Projects where this AM's team members are assigned.
      const myTeam = await User.findAll({
        where: { manager_id: userId },
        attributes: ["id"],
        raw: true,
      });
      const myTeamIds = myTeam.map((u: any) => u.id);

      if (myTeamIds.length > 0) {
        const teamProjects = await ProjectMember.findAll({
          where: { user_id: { [Op.in]: myTeamIds } },
          attributes: ["project_id"],
          raw: true,
        });
        const myTeamProjectIds = [
          ...new Set(teamProjects.map((pm: any) => String(pm.project_id))),
        ];
        if (myTeamProjectIds.length > 0) {
          waysIn.push({ id: { [Op.in]: myTeamProjectIds } });
        }
      }

      // 3. Projects no AM holds yet - visible to every AM until one is assigned.
      const allAMs = await User.findAll({
        where: { role: "AM" },
        attributes: ["id"],
        raw: true,
      });
      const allAMIds = allAMs.map((u: any) => u.id);

      const amAssignedProjects = await ProjectMember.findAll({
        where: { user_id: { [Op.in]: allAMIds } },
        attributes: ["project_id"],
        raw: true,
      });
      const projectsAssignedToAnyAM = [
        ...new Set(amAssignedProjects.map((pm: any) => String(pm.project_id))),
      ];

      // Op.in/Op.notIn on an empty array compile to `IN (NULL)`, which matches
      // nothing - so only add each key when it actually has ids to test.
      const unclaimed: any = {
        [Op.or]: [{ created_by: null }, { created_by: { [Op.notIn]: allAMIds } }],
      };
      if (projectsAssignedToAnyAM.length > 0) {
        unclaimed.id = { [Op.notIn]: projectsAssignedToAnyAM };
      }
      waysIn.push(unclaimed);
    }

    const visibility: any = { [Op.or]: waysIn };

    // Department gate. Matched exactly, so a stray case or space in either
    // users.department or projects.client_department will hide a project that
    // is only in scope by department - an assigned one still comes through.
    const currentUser: any = await User.findByPk(userId, {
      attributes: ["department"],
      raw: true,
    });
    if (currentUser?.department) {
      return {
        [Op.and]: [
          visibility,
          {
            [Op.or]: [
              { client_department: currentUser.department },
              { id: { [Op.in]: myDirectProjectIds } },
            ],
          },
        ],
      };
    }

    return visibility;
  }

  public async getProjectStats(userId?: string, userRole?: string) {
    try {
      // Same visibility rules as the project list, so the cards and the table
      // can never disagree about which projects are in scope.
      const projectWhereClause =
        (await this.buildProjectVisibilityWhere(userId, userRole)) || {};

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

  // Domains a user is linked to — for an AM this is the set of domains they own.
  public async getDomainIdsForUser(user_id: string): Promise<string[]> {
    try {
      const rows = await DomainAssignment.findAll({
        where: { user_id },
        attributes: ["domain_id"],
        raw: true,
      });
      return [...new Set(rows.map((r: any) => r.domain_id))];
    } catch (error) {
      throw error;
    }
  }

  // Everyone assigned to any of this user's domains. An AM uses this to see the
  // shared users (is_shared) that were assigned to the domains they are linked to.
  public async getDomainPeerUserIds(user_id: string): Promise<string[]> {
    try {
      const domainIds = await this.getDomainIdsForUser(user_id);
      if (!domainIds.length) return [];
      const rows = await DomainAssignment.findAll({
        where: { domain_id: { [Op.in]: domainIds } },
        attributes: ["user_id"],
        raw: true,
      });
      return [...new Set(rows.map((r: any) => r.user_id))];
    } catch (error) {
      throw error;
    }
  }

  // Replaces a user's domain links with exactly `domain_ids`.
  public async syncUserDomains(user_id: string, domain_ids: string[]) {
    try {
      const current = await this.getDomainIdsForUser(user_id);
      const stale = current.filter((id) => !domain_ids.includes(id));
      if (stale.length) {
        await DomainAssignment.destroy({
          where: { user_id, domain_id: { [Op.in]: stale } },
        });
      }
      const missing = domain_ids.filter((id) => !current.includes(id));
      if (missing.length) {
        await DomainAssignment.bulkCreate(
          missing.map((domain_id) => ({ domain_id, user_id })),
          { ignoreDuplicates: true },
        );
      }
      return domain_ids;
    } catch (error) {
      throw error;
    }
  }

  public async findDomainsByIds(domain_ids: string[]) {
    try {
      if (!domain_ids.length) return [];
      return await Domain.findAll({
        where: { id: { [Op.in]: domain_ids } },
        attributes: ["id", "name"],
        raw: true,
      });
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

      const visibility = await this.buildProjectVisibilityWhere(userId, userRole);

      const clauses: any[] = [];
      if (visibility) clauses.push(visibility);
      if (search && search.trim()) {
        clauses.push({ name: { [Op.iLike]: `%${search.trim()}%` } });
      }
      const whereClause: any = clauses.length ? { [Op.and]: clauses } : {};

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
    is_shared?: string;
    page: number;
    limit: number;
  }) {
    try {
      const { search, role, isBlocked, project_id, manager_id, is_shared, page, limit } = filters;
      const whereClause: any = {
        id: { [Op.ne]: "2f3xfkSN5zHdYa5" },
        role: { [Op.ne]: "SP" },
      };

      if (manager_id) {
        // A manager sees their own team PLUS shared users (e.g. a tester spanning
        // several domains) that are assigned to one of this manager's domains.
        // A shared user assigned to two domains therefore shows up for both of
        // those domains' managers, and for nobody else.
        // Nested under Op.and so it can't collide with the search Op.or below.
        const domainPeerIds = await this.getDomainPeerUserIds(manager_id);
        whereClause[Op.and] = [
          {
            [Op.or]: [
              { manager_id },
              { is_shared: true, id: { [Op.in]: domainPeerIds } },
            ],
          },
        ];
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

      // Narrows to shared users (or explicitly to non-shared ones), so the room
      // pool can ask for the shared half by itself instead of reading every
      // user and filtering client-side — which silently lost anyone past the
      // 100-row cap.
      //
      // Deliberately ANDed ON TOP of the manager scoping above rather than
      // replacing it: for an AM that still means "shared users in my domains",
      // exactly the set they can see today. Returning EVERY shared user to an
      // AM would widen what the role can read, which is a permissions decision,
      // not a filter.
      if (is_shared !== undefined) {
        whereClause.is_shared = is_shared === "true";
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
        // Domains a shared user is assigned to
        {
          model: Domain,
          as: "assignedDomains",
          attributes: ["id", "name"],
          through: { attributes: [] },
          required: false,
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
  // Single user for the edit modal: everything the add/edit form collects, plus
  // the projects and the domains a shared user is scoped to. Password is never
  // selected. Access is enforced in the service layer.
  public async findUserById(id: string) {
    try {
      return await User.findByPk(id, {
        attributes: ["id", "role", "is_shared", "manager_id"],
      });
    } catch (error) {
      throw error;
    }
  }

  public async getUserDetails(id: string) {
    try {
      return await User.findOne({
        where: { id },
        attributes: { exclude: ["password"] },
        include: [
          {
            model: Project,
            as: "projects",
            attributes: ["id", "name"],
            through: { attributes: [] },
            required: false,
          },
          {
            model: Domain,
            as: "assignedDomains",
            attributes: ["id", "name"],
            through: { attributes: [] },
            required: false,
          },
        ],
      });
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
      // If any user being removed is an AM, also remove their direct reports
      // (USER/DEVLOPER with manager_id = AM.id) from this same project.
      const amsBeingRemoved = await User.findAll({
        where: {
          id: { [Op.in]: user_ids },
          role: "AM",
        },
        attributes: ["id"],
        raw: true,
      });
      const amIds = amsBeingRemoved.map((u: any) => u.id);

      let expandedIds: string[] = [...user_ids];

      if (amIds.length > 0) {
        const teamMembers = await User.findAll({
          where: {
            manager_id: { [Op.in]: amIds },
            role: { [Op.in]: ["USER", "DEVLOPER"] },
          },
          attributes: ["id"],
          raw: true,
        });
        const teamIds = teamMembers.map((u: any) => u.id);

        if (teamIds.length > 0) {
          const inProject = await ProjectMember.findAll({
            where: {
              project_id,
              user_id: { [Op.in]: teamIds },
            },
            attributes: ["user_id"],
            raw: true,
          });
          const cascadeIds = inProject.map((m: any) => m.user_id);
          expandedIds = [...new Set([...expandedIds, ...cascadeIds])];
        }
      }

      // Snapshot which of the requested ids were actually members before destroy,
      // so notifications go only to users who were really removed.
      const actuallyMembers = await ProjectMember.findAll({
        where: {
          project_id,
          user_id: { [Op.in]: expandedIds },
        },
        attributes: ["user_id"],
        raw: true,
      });
      const removedUserIds = actuallyMembers.map((m: any) => m.user_id);

      const removed = await ProjectMember.destroy({
        where: {
          project_id,
          user_id: { [Op.in]: expandedIds },
        },
      });
      if (removed === 0) throw new Error("No members found to remove");

      // After project-member removal: if any removed user no longer holds another
      // project in this project's domain, also strip their DomainAssignment.
      const project = await Project.findByPk(project_id, {
        attributes: ["id", "name", "domain_id"],
        raw: true,
      });
      const projectName = (project as any)?.name || "the project";
      const domainId = (project as any)?.domain_id;
      if (domainId) {
        const otherProjectsInDomain = await Project.findAll({
          where: {
            domain_id: domainId,
            id: { [Op.ne]: project_id },
          },
          attributes: ["id"],
          raw: true,
        });
        const otherProjectIds = otherProjectsInDomain.map((p: any) => p.id);

        let usersStillInDomain = new Set<string>();
        if (otherProjectIds.length > 0) {
          const stillIn = await ProjectMember.findAll({
            where: {
              user_id: { [Op.in]: expandedIds },
              project_id: { [Op.in]: otherProjectIds },
            },
            attributes: ["user_id"],
            raw: true,
          });
          usersStillInDomain = new Set(stillIn.map((m: any) => m.user_id));
        }

        const usersToUnassign = expandedIds.filter(
          (uid: string) => !usersStillInDomain.has(uid),
        );

        if (usersToUnassign.length > 0) {
          await DomainAssignment.destroy({
            where: {
              domain_id: domainId,
              user_id: { [Op.in]: usersToUnassign },
            },
          });
        }
      }

      // Notify each user who was actually removed from the project.
      for (const removedUserId of removedUserIds) {
        await notificationRepo.create({
          user_id: removedUserId,
          type: "project_removed",
          title: "Removed from Project",
          message: `You have been removed from project "${projectName}".`,
          reference_id: project_id,
        });
      }

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
  // excludeId keeps an edit from colliding with the row being edited: saving a
  // user without touching their employee_id must not report a duplicate.
  public async findUserByEmployeeId(employee_id: string, excludeId?: string) {
    try {
      const where: any = { employee_id };
      if (excludeId) where.id = { [Op.ne]: excludeId };
      return await User.findOne({ where });
    } catch (error) {
      throw error;
    }
  }

  public async findUserByEmail(email: string, excludeId?: string) {
    try {
      const where: any = { email };
      if (excludeId) where.id = { [Op.ne]: excludeId };
      return await User.findOne({ where });
    } catch (error) {
      throw error;
    }
  }

  public async findProjectsByIds(project_ids: string[]) {
    try {
      if (!project_ids.length) return [];
      return await Project.findAll({
        where: { id: { [Op.in]: project_ids } },
        attributes: ["id", "name"],
        raw: true,
      });
    } catch (error) {
      throw error;
    }
  }

  public async getProjectIdsForUser(user_id: string): Promise<string[]> {
    try {
      const rows = await ProjectMember.findAll({
        where: { user_id },
        attributes: ["project_id"],
        raw: true,
      });
      return rows.map((r: any) => String(r.project_id));
    } catch (error) {
      throw error;
    }
  }

  // Replaces a user's project memberships with exactly `project_ids`.
  // Mirrors syncUserDomains: the edit modal sends the whole set, not a delta,
  // so an id missing from the list means "detach", and [] detaches from all.
  // Deliberately not routed through removeMembers - that path also unassigns an
  // AM's direct reports, which is right for the project screen and wrong here.
  public async syncUserProjects(user_id: string, project_ids: string[]) {
    try {
      const current = await this.getProjectIdsForUser(user_id);
      const stale = current.filter((id) => !project_ids.includes(id));
      if (stale.length) {
        await ProjectMember.destroy({
          where: { user_id, project_id: { [Op.in]: stale } },
        });
      }
      const missing = project_ids.filter((id) => !current.includes(id));
      if (missing.length) {
        await ProjectMember.bulkCreate(
          missing.map((project_id) => ({ project_id, user_id })),
          { ignoreDuplicates: true },
        );
      }
      return project_ids;
    } catch (error) {
      throw error;
    }
  }

  // Partial update. A key that is absent from `data` is never written, so a
  // password-only save cannot null out the profile and a profile save cannot
  // touch the password.
  //
  // `data.password`, when present, MUST already be a bcrypt hash - the service
  // is the only caller and hashes before it gets here. Nothing on this path
  // hashes for you, so a raw string would land raw.
  public async editUser(data: EditUserDTO) {
    try {
      const {
        id, fullName, email, password, role, manager_id, is_shared,
        job_title, employee_id, contact_number, date_of_birth,
        blood_group, department, work_schedule, joining_date,
        require_password_change,
      } = data;

      const user = await User.findByPk(id);
      if (!user) throw new Error("User not found");

      const updateLoad: any = {};
      if (fullName !== undefined) updateLoad.fullName = fullName;
      if (email !== undefined) updateLoad.email = email;
      if (password !== undefined) updateLoad.password = password;
      if (role !== undefined) updateLoad.role = role;
      // Never clear the reporting manager from a blank form field: leave
      // approval routes through manager_id and needs a single owner.
      if (manager_id !== undefined && manager_id !== null && String(manager_id).trim() !== "")
        updateLoad.manager_id = manager_id;
      if (is_shared !== undefined) updateLoad.is_shared = String(is_shared) === "true";
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
