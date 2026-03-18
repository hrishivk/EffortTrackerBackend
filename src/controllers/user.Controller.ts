import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { userService } from "../service/user.service";
import { superAdminService } from "../service/super-admin.service";
const UserService = new userService();
const SuperAdminService = new superAdminService();

export class userController {
  public async task(req: Request, res: Response) {
    try {
      const { created_by, assigned_to, project, project_id, description, priority, end_time, status } = req.body;
      const data = await UserService.addTask({
        created_by,
        assigned_to,
        project,
        project_id,
        description,
        priority,
        end_time,
        status,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Task added successful",
        data,
      });
    } catch (error: any) {
      const isLocked =
        error.message === "Daily log is locked. Cannot add new task.";
      const statusCode = isLocked
        ? HTTP_statusCode.locked
        : HTTP_statusCode.TaskFailed;
      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task creation failed",
      });
    }
  }
  public async taskList(req: Request, res: Response) {
    try {
      const { date, assigned_to, project, page = "1", limit = "10" } = req.query;
      const id = req.user?.id;
      const role = req.user?.role;
      const result = await UserService.listTask({
        date, id, role, assigned_to, project,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "fetch task successful",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      if (error.message == "No task found") {
        sendResponse(res, HTTP_statusCode.OK, {
          success: true,
          message: "No task found",
          data: [],
          totalPages: 0,
        });
      } else {
        sendResponse(res, HTTP_statusCode.TaskFailed, {
          success: false,
          message: error.message || "task fetch failed",
        });
      }
    }
  }

  public async statusUpdate(req: Request, res: Response) {
    try {
       console.log(req.query.id)
      const id = req.query.id as string
     
      const newStatus = req.body.status;
      const data = await UserService.updateStatus({ id, status: newStatus });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task status updated successfuly",
        data,
      });
    } catch (error: any) {
      console.log(error)
      const errorStatusMap: Record<string, number> = {
        "Daily log is locked. Cannot update task status.":
          HTTP_statusCode.locked,
        "A task is currently in progress for today": HTTP_statusCode.locked,
      };

      const statusCode =
        errorStatusMap[error.message] || HTTP_statusCode.TaskFailed;

      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task status update failed",
      });
    }
  }
  public async listProjects(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const result = await SuperAdminService.getAllProjects(userId, userRole, search, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Projects fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Fetching projects failed",
      });
    }
  }

  public async taskLock(req: Request, res: Response) {
    try {
      const { date, id } = req.query;
      const data = await UserService.lockDailyTask({ date, id });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "daily task locked successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.TaskFailed, {
        success: false,
        message: error.message || "task fetch failed",
      });
    }
  }
}
