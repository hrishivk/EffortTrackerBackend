import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { userService } from "../service/user.service";
const UserService = new userService();

export class userController {
  public async task(req: Request, res: Response) {
    try {
      const { userId, project, description, priority } = req.body;
      const data = await UserService.addTask({
        userId,
        project,
        description,
        priority,
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
      const { date, id } = req.query;
      const data = await UserService.listTask({ date, id });
      console.log(data)
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "fetch task successful",
        data,
      });
    } catch (error: any) {
      console.log(error.message == "No task found");
      console.log(error.message);
      if (error.message == "No task found") {
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
