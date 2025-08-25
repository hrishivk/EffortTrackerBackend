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

const CredentialHashing = new credentialHashing();

export class UserRepository {
  async findUserByEmail(email: string) {
  try {
    return await User.findOne({
      where: { email },
        include: [
          {
            model: Project,
            include: [{ model: Domain }], 
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
  async findTask(id: number) {
    return await Task.findOne({
      where: { id },
      include: [
        {
          model: DailyTaskLog,
          attributes: ["locked"],
        },
      ],
    });
  }
async findCheckTask(daily_log_id: string, date: Date, id: number) {
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
      status: "In Progress",
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

  public async secureToken(email: string, role: string) {
    try {
      const token = await CredentialHashing.hashtoken(email, role);
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
  public async findDailyTaskLog(dailytaskTime: string, userId: string) {
    try {
      return await DailyTaskLog.findOne({
        where: {
          user_id: userId,
          date: dailytaskTime,
        },
      });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createDailyTaskLog(userId: string, dailytaskTime: string) {
    try {
      return await DailyTaskLog.create({
        user_id: userId,
        date: dailytaskTime,
        total_time: "0",
      });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async createNewTask(data: AddTask):Promise<Task> {
    try {
      const { dailyTaskLog, project, description, priority } = data;
      return await Task.create({
        daily_log_id: dailyTaskLog.id,
        project: project,
        description: description,
        priority: priority,
      });
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
  public async findDailyLogs(date: string, id: string) {
    try {
       const rawDate = new Date(date as string);
    const formattedDate = rawDate.toLocaleDateString("en-CA")
    console.log(formattedDate)
      return await DailyTaskLog.findOne({
        where: {
          user_id: id,
          date: formattedDate,
        },
      });
    } catch (error) {
      throw error;
    }
  }
  
  public async findClosestPreviousLog(date: string, id: string) {
    try {
     return await DailyTaskLog.findOne({where:{
      user_id: id,
      date:{
        [Op.lt]:date
      },
     },order:[['date','DESC']]
    })
    } catch (error) {
      throw error;
    }
  }
  
public async lockDailyTask(data: any) {
  try {
    const { date, id } = data;

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      throw new Error('Invalid date input received');
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
          user_id: id,
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
        message: 'No daily task logs found to lock',
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
      message: 'Daily tasks and associated tasks locked successfully',
      dailyTaskLog: updatedLogs,
      tasks: updatedTasks,
    };

  } catch (error) {
    console.error('lockDailyTask error:', error);
    throw error;
  }
}

  public async todayTask(id: number) {
    try {
     const data= await Task.findAll({
        where: {
          daily_log_id: id,
        },
        order: [["created_at", "DESC"]],
      });

      return data
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
      newStatus.toLowerCase() === "in progress"
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
