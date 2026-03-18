import { User } from "../connection/models/user";
import bcrypt from "bcrypt";
import { credentialHashing } from "../credential/hash";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
import { AddTask } from "../types/user.types";
import { Task } from "../connection/models/tasks";
import { TaskStatus } from "../types/task.types";
import { Model, Op } from "sequelize";
import { Project } from "../connection/models/project";
import { Domain } from "../connection/models/domain";
import { ProjectMember } from "../connection/models/project_member";

const CredentialHashing = new credentialHashing();
export class UserRepository {
  async findUserByEmail(email: string) {
    try {
      return await User.findOne({
        where: { email },
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
      console.error("Error finding user by email:", error);
      throw error;
    }
  }

  async verifyPassword(
    plainpassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    try {
      const isMatch = await bcrypt.compare(plainpassword, hashedPassword);
      return isMatch;
    } catch (error) {
      console.error("Error verifying password:", error);
      throw error;
    }
  }
  async findTask(id: string) {
    const data = await Task.findOne({
      where: { id },
      include: [
        {
          model: DailyTaskLog,
          as: "dailyLog",
          attributes: ["locked"],
        },
      ],
    });
    return data;
  }
  async findCheckTask(daily_log_id: string, date: Date, id: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await Task.findOne({
      where: {
        daily_log_id,
        created_at: {
          [Op.between]: [startOfDay, endOfDay],
        },
        status: "in_progress",
        id: {
          [Op.ne]: id,
        },
      },
    });
  }
  async securePassword(password: string) {
    try {
      const hashPassword = await CredentialHashing.hashPassword(password);
      return hashPassword;
    } catch (error) {
      console.error("Error hashing password:", error);
      throw error;
    }
  }

  public async secureToken(id: string, email: string, role: string) {
    try {
      const token = await CredentialHashing.hashtoken(id, email, role);
      const hashToken = token
        ? token
        : (() => {
            throw new Error("token not found");
          })();

      return hashToken;
    } catch (error) {
      console.error("Failed to secure token and set cookie:", error);
      throw error;
    }
  }

  public async createUser(userData: any) {
    try {
      return await User.create(userData);
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    }
  }
  public async setUserActive(userId: string) {
    try {
      return await User.update({ lastSeenAt: null }, { where: { id: userId } });
    } catch (error) {
      console.error("Error setting user active:", error);
      throw error;
    }
  }

  public async setUserLogout(userId: string) {
    try {
      return await User.update(
        { lastSeenAt: new Date().toISOString() },
        { where: { id: userId } }
      );
    } catch (error) {
      console.error("Error setting user logout:", error);
      throw error;
    }
  }
  public async findDailyTaskLog(dailytaskTime: string, created_by: string | undefined, assigned_to: string | undefined) {
    try {
      return await DailyTaskLog.findOne({
        where: {
          created_by: created_by,
          assigned_to: assigned_to,
          date: dailytaskTime,
        },
      });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createDailyTaskLog(created_by?: string, assigned_to?: string, dailytaskTime?: string, project_id?: string) {
    try {
      const data = await DailyTaskLog.create({
        created_by: created_by ?? assigned_to,
        assigned_to: assigned_to,
        date: dailytaskTime,
        project_id: project_id || null,
        total_time: "0",
      });
      return data;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createNewTask(data: AddTask): Promise<Task> {
    try {
      const { dailyTaskLog, project_id, description, priority, end_time, status } = data;
      const taskData: any = {
        daily_log_id: dailyTaskLog.id,
        project_id: project_id,
        description: description,
        priority: priority,
      };
      if (end_time) taskData.end_time = new Date(end_time);
      if (status) taskData.status = status;
      return await Task.create(taskData);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async findDailyLogs(date: string, id: string, role?: string, assigned_to?: string) {
    try {
      const formattedDate = date.split("T")[0];
      if (role == "SP") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              date: formattedDate,
            },
          });
        }
        // SP sees all tasks
        return await DailyTaskLog.findAll({
          where: {
            date: formattedDate,
          },
        });
      } else if (role == "AM") {
        // If assigned_to filter is provided, show that specific user's tasks
        if (assigned_to) {
          return await DailyTaskLog.findAll({
            where: {
              assigned_to: assigned_to,
              date: formattedDate,
            },
          });
        }
        // Get all users/developers managed by this AM
        const managedUsers = await User.findAll({
          where: { manager_id: id },
          attributes: ["id"],
        });
        const managedUserIds = managedUsers.map((u: any) => u.id);
        // AM sees: tasks they created OR assigned to them OR assigned to their team members
        return await DailyTaskLog.findAll({
          where: {
            [Op.or]: [
              { created_by: id },
              { assigned_to: id },
              ...(managedUserIds.length > 0 ? [{ assigned_to: { [Op.in]: managedUserIds } }] : []),
            ],
            date: formattedDate,
          },
        });
      } else {
        // USER/DEVELOPER: tasks assigned to them or created by them
        return await DailyTaskLog.findAll({
          where: {
            [Op.or]: [
              { assigned_to: id },
              { created_by: id },
            ],
            date: formattedDate,
          },
        });
      }
    } catch (error) {
      throw error;
    }
  }
  public async findClosestPreviousLog(date: string, id: string) {
    try {
      return await DailyTaskLog.findAll({
        where: {
          assigned_to: id,
          date: {
            [Op.lt]: date,
          },
        },
        order: [["date", "DESC"]],
      });
    } catch (error) {
      throw error;
    }
  }

  public async lockDailyTask(data: any) {
    try {
      const { date, id } = data;

      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        throw new Error("Invalid date input received");
      }

      const startOfDay = new Date(parsedDate);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(parsedDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      const [_, updatedLogs] = await DailyTaskLog.update(
        {
          locked: true,
          locked_at: new Date(),
        },
        {
          where: {
            assigned_to: id,
            created_at: {
              [Op.between]: [startOfDay, endOfDay],
            },
          },
          returning: true,
        }
      );

      const dailyLogIds = updatedLogs.map((log: any) => log.id);

      if (dailyLogIds.length === 0) {
        return {
          message: "No daily task logs found to lock",
          dailyTaskLog: [],
          tasks: [],
        };
      }

      const [__, updatedTasks] = await Task.update(
        {
          isLocked: true,
          updated_at: new Date(),
        },
        {
          where: {
            daily_log_id: {
              [Op.in]: dailyLogIds,
            },
          },
          returning: true,
        }
      );

      return {
        message: "Daily tasks and associated tasks locked successfully",
        dailyTaskLog: updatedLogs,
        tasks: updatedTasks,
      };
    } catch (error) {
      console.error("lockDailyTask error:", error);
      throw error;
    }
  }

  public async todayTask(ids: string[] | string, projectId?: string, offset?: number, limit?: number): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const idArray = Array.isArray(ids) ? ids : [ids];
      const whereClause: any = {
        daily_log_id: {
          [Op.in]: idArray,
        },
      };
      if (projectId) {
        whereClause.project_id = projectId;
      }

      const queryOptions: any = {
        where: whereClause,
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
          },
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
              {
                model: User,
                as: "creator",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
        order: [["created_at", "DESC"]],
      };

      if (offset !== undefined) queryOptions.offset = offset;
      if (limit !== undefined) queryOptions.limit = limit;

      const { count, rows } = await Task.findAndCountAll(queryOptions);

      return { tasks: rows, totalCount: count };
    } catch (error) {
      throw error;
    }
  }
  public async tasksByProject(projectId: string, offset?: number, limit?: number): Promise<{ tasks: Task[]; totalCount: number }> {
    try {
      const queryOptions: any = {
        where: { project_id: projectId },
        include: [
          {
            model: Project,
            as: "project",
            attributes: ["id", "name"],
          },
          {
            model: DailyTaskLog,
            as: "dailyLog",
            attributes: ["id", "created_by", "assigned_to", "date"],
            include: [
              {
                model: User,
                as: "assignedUser",
                attributes: ["id", "fullName", "email"],
              },
              {
                model: User,
                as: "creator",
                attributes: ["id", "fullName", "email"],
              },
            ],
          },
        ],
        order: [["created_at", "DESC"]],
      };

      if (offset !== undefined) queryOptions.offset = offset;
      if (limit !== undefined) queryOptions.limit = limit;

      const { count, rows } = await Task.findAndCountAll(queryOptions);
      return { tasks: rows, totalCount: count };
    } catch (error) {
      throw error;
    }
  }

  public async updateTaskStatus(task: Task, newStatus?: string): Promise<Task> {
    try {
      if (!newStatus) {
        throw new Error("Status is required");
      }
      const now = new Date();
      newStatus.toLowerCase() === "in_progress"
        ? (task.start_time = now)
        : newStatus.toLowerCase() === "completed"
        ? (task.end_time = now)
        : null;
      task.status = newStatus as TaskStatus;
      task.updated_at = now;
      await task.save();
      return task;
    } catch (error) {
      console.error("Error updating task status:", error);
      throw error;
    }
  }
}
