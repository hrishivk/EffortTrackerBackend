import { UserRepository } from "../repositories/user.repository";
import {
  AddTask,
  AddUserDTO,
  LoginResponse,
  PublicUser,
} from "../types/user.types";
import { envConfig } from "../config/env.config";

import { TaskStatusUpdate, TaskWithDailyLog } from "../types/task.types";
import { Task } from "../connection/models/tasks";
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

      let todayLog = await userRepository.findDailyLogs(formattedToday, id);

      if (!todayLog) {
        const previousLog = await userRepository.findClosestPreviousLog(
          formattedToday,
          id
        );

        if (previousLog) {
          const previousTasks = await userRepository.todayTask(previousLog.id);

          const carryOverTasks = previousTasks.filter((task: any) => {
            const status = task.dataValues.status?.toLowerCase().trim();
            return status === "in progress" || status === "yet to start";
          });

          if (carryOverTasks.length > 0) {
            todayLog = await userRepository.createDailyTaskLog(
              id,
              formattedToday
            );
            for (const task of carryOverTasks) {
              await userRepository.createNewTask({
                userId: id,
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
      const { userId, project, description, priority } = data;
      const dailytaskTime = new Date().toISOString().split("T")[0];

      let dailyTaskLog = await userRepository.findDailyTaskLog(
        dailytaskTime,
        userId
      );

      if (!dailyTaskLog) {
        dailyTaskLog = await userRepository.createDailyTaskLog(
          userId,
          dailytaskTime
        );
      }
      if (dailyTaskLog?.dataValues.locked) {
        throw new Error("Daily log is locked. Cannot add new task.");
      }
      const newTask = await userRepository.createNewTask({
        userId,
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
      console.log(data);
      const { date, id } = data;
      const todayLog = await userRepository.findDailyLogs(date, id);
      if (!todayLog) {
        throw new Error("No task found");
      }

      return await userRepository.todayTask(todayLog.id);
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
      console.log(task)
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

  public async addUser(data: AddUserDTO): Promise<any> {
    const {
      fullName,
      email,
      password,
      role,
      projects,
      manager_id,
      profileFilename,
    } = data;
    if (!password) {
      throw new Error("Password is required.");
    }
    const emailExists = await userRepository.findUserByEmail(email);
    if (emailExists) {
      throw new Error("Email already exists.");
    }
    try {
      const hashedPassword = await userRepository.securePassword(password);
      const newUser = {
        fullName: fullName.trim(),
        email: email.trim(),
        password: hashedPassword,
        role: role.toUpperCase(),
        manager_id: manager_id || null,
        project_id: projects || null,
        lastSeenAt: "No login activity recorded",
      };
      const createdUser = await userRepository.createUser(newUser);
      return createdUser;
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw new Error(error.message || "Failed to create user.");
    }
  }
}
