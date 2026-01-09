import { UserRepository } from "../repositories/user.repository";
import {
  AddTask,
  LoginResponse,
} from "../types/user.types";


import { TaskStatusUpdate, TaskWithDailyLog } from "../types/task.types";
import { Task } from "../connection/models/tasks";
import { DailyTaskLog } from "../connection/models/daily_task_logs";
const userRepository = new UserRepository();

export class userService {
  public async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const user = (await userRepository.findUserByEmail(email)) as any;

      if (!user) {
        throw new Error("User not found");
      }
      if (user.dataValues.isBlocked) {
        throw new Error("Your account has been blocked ");
      }
      const isValid = await userRepository.verifyPassword(
        password,
        user.dataValues.password
      );
      if (!isValid) {
        throw new Error("Invalid Password");
      }
      let projectName = (user as any).Project?.name ?? null;
      await userRepository.setUserActive(user.id as string);
      const { id, role, email: userEmail, fullName, image } = user.dataValues;
      const token = await userRepository.secureToken(user.email, role);
      const today = new Date();
      const formattedToday = today.toISOString().split("T")[0];
       let todayLogs = await userRepository.findDailyLogs(formattedToday, id);
      let todayLog: DailyTaskLog| null = todayLogs.length > 0 ? todayLogs[0] : null;
      if (!todayLog )  {
        const previousLog = await userRepository.findClosestPreviousLog(
          formattedToday,
          id
        )   
        if (previousLog ) {       
          const previousTasks = await userRepository.todayTask(previousLog.id)
          const carryOverTasks = previousTasks.filter((task: any) => {
            const status = task.dataValues.status?.toLowerCase().trim();
            return status === "in progress" || status === "yet to start";
          });
          if (carryOverTasks.length > 0) {
              const today = new Date();
                const formattedToday = today.toISOString().split("T")[0]; 
             todayLog=await userRepository.createDailyTaskLog( undefined,id,formattedToday);
            for (const task of carryOverTasks) {
              await userRepository.createNewTask({
                dailyTaskLog: todayLog,
                project: task.project,
                description: task.description,
                priority: task.priority,
              });
            }
          }
        }
      }
      return {
        user: {
          id,
          role,
          email,
          fullName,
          projectName,
        },
        token,
      };
    } catch (error: any) {
      console.log(error)
      throw new Error(error.message || "Login failed");
    }
  }

  public async logout(id: string) {
    try {
      return await userRepository.setUserLogout(id as string);
    } catch (error: any) {
      throw new Error(error.message || "logout failed");
    }
  }
  public async addTask(data: AddTask): Promise<Task> {
    try {
      const { created_by, assigned_to, project, description, priority } = data;
      const dailytaskTime = new Date().toISOString().split("T")[0];
      let dailyTaskLog = await userRepository.findDailyTaskLog(
        dailytaskTime,
        created_by,
        assigned_to
      );

      if (!dailyTaskLog) {
        dailyTaskLog = await userRepository.createDailyTaskLog(
          created_by,
          assigned_to,
          dailytaskTime
        );
      }
      if (dailyTaskLog?.dataValues.locked) {
        throw new Error("Daily log is locked. Cannot add new task.");
      }
      const newTask = await userRepository.createNewTask({
        created_by,
        assigned_to,
        dailyTaskLog,
        project,
        description,
        priority,
      });
      return newTask;
    } catch (error: any) {
      console.error(" Error in addTask:", error.message);
      throw new Error(error.message || "Failed");
    }
  }
  public async listTask(data: any): Promise<Task[]> {
    try {
      const { date, id, role } = data;
      const todayLog = await userRepository.findDailyLogs(date, id, role);
      if (!todayLog) {
        throw new Error("No task found");
      }
      const logIds = todayLog.map((log: any) => log.id);
      return await userRepository.todayTask(logIds);
    } catch (error) {
      console.error("Error in listTask:", error);
      throw error;
    }
  }

  public async lockDailyTask(data: any) {
    try {
      const locked = await userRepository.lockDailyTask(data);
      const todayLog = await userRepository.findDailyLogs(data.date, data.id);
      if (!todayLog) {
        throw new Error("No task found");
      }
      return locked;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  public async updateStatus(data: TaskStatusUpdate) {
    try {
      const { id, status } = data;
      const todayDate = new Date();
      const task = (await userRepository.findTask(id)) as TaskWithDailyLog;
      if (!task) throw new Error("Task not found");
      console.log(task);
      if (task.isLocked) {
        throw new Error("Daily log is locked. Cannot update task status.");
      }
      const task_id = task.dataValues.daily_log_id;
      const existInprogress = await userRepository.findCheckTask(
        task_id,
        todayDate,
        id
      );
      if (existInprogress) {
        throw new Error("A task is currently in progress for today");
      }
      return await userRepository.updateTaskStatus(task, status);
    } catch (error) {
      console.error("Error in updateStatus:", error);
      throw error;
    }
  }
}
