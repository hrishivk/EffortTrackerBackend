import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { userService } from "../service/user.service";
import { superAdminService } from "../service/super-admin.service";
import { LeaveService } from "../service/leave.service";
import { NotificationRepository } from "../repositories/notification.repository";
import { AttendanceRepository } from "../repositories/attendance.repository";
const UserService = new userService();
const SuperAdminService = new superAdminService();
const leaveService = new LeaveService();
const notificationRepo = new NotificationRepository();
const attendanceRepo = new AttendanceRepository();

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

  // ── Leave Management ──

  public async applyLeave(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const { leave_type, session, start_date, end_date, reason, contact } = req.body;
      if (!leave_type || !session || !start_date || !end_date || !reason) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "leave_type, session, start_date, end_date, and reason are required",
        });
        return;
      }
      const data = await leaveService.applyLeave({
        user_id,
        leave_type,
        session,
        start_date,
        end_date,
        reason,
        contact,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Leave applied successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to apply leave",
      });
    }
  }

  public async getMyLeaves(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const status = req.query.status as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const result = await leaveService.getMyLeaves(user_id, status, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Leaves fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch leaves",
      });
    }
  }

  public async getLeaveBalance(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const data = await leaveService.getLeaveBalance(user_id);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Leave balance fetched successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch leave balance",
      });
    }
  }

  public async getPendingForManager(req: Request, res: Response) {
    try {
      const manager_id = req.user?.id;
      if (!manager_id) throw new Error("User not authenticated");
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const result = await leaveService.getPendingForManager(manager_id, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Pending leaves fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch pending leaves",
      });
    }
  }

  public async managerAction(req: Request, res: Response) {
    try {
      const manager_id = req.user?.id;
      if (!manager_id) throw new Error("User not authenticated");
      const { leave_id, action, remarks } = req.body;
      if (!leave_id || !action) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "leave_id and action are required",
        });
        return;
      }
      if (action !== "approve" && action !== "reject") {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "action must be 'approve' or 'reject'",
        });
        return;
      }
      const data = await leaveService.managerAction(leave_id, manager_id, action, remarks);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: `Leave ${action === "approve" ? "approved" : "rejected"} by manager`,
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to process leave action",
      });
    }
  }

  public async getPendingForAdmin(req: Request, res: Response) {
    try {
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const result = await leaveService.getPendingForAdmin(page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Manager-approved leaves fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch pending admin leaves",
      });
    }
  }

  public async adminAction(req: Request, res: Response) {
    try {
      const admin_id = req.user?.id;
      if (!admin_id) throw new Error("User not authenticated");
      const { leave_id, action, remarks } = req.body;
      if (!leave_id || !action) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "leave_id and action are required",
        });
        return;
      }
      if (action !== "approve" && action !== "reject") {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "action must be 'approve' or 'reject'",
        });
        return;
      }
      const data = await leaveService.adminAction(leave_id, admin_id, action, remarks);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: `Leave ${action === "approve" ? "approved" : "rejected"} by admin`,
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to process admin leave action",
      });
    }
  }

  public async cancelLeave(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const { leave_id } = req.body;
      if (!leave_id) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "leave_id is required",
        });
        return;
      }
      const data = await leaveService.cancelLeave(leave_id, user_id);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Leave cancelled successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to cancel leave",
      });
    }
  }

  // ── Notifications ──

  public async getNotifications(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const result = await notificationRepo.getByUserId(user_id, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Notifications fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch notifications",
      });
    }
  }

  public async getNotificationCount(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const count = await notificationRepo.getUnreadCount(user_id);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Unread count fetched successfully",
        data: { unreadCount: count },
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch notification count",
      });
    }
  }

  public async markNotificationRead(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const { notification_id } = req.body;
      if (!notification_id) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "notification_id is required",
        });
        return;
      }
      const data = await notificationRepo.markAsRead(notification_id, user_id);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Notification marked as read",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to mark notification as read",
      });
    }
  }

  public async markAllNotificationsRead(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      await notificationRepo.markAllAsRead(user_id);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "All notifications marked as read",
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to mark notifications as read",
      });
    }
  }

  // ── Attendance ──

  public async recordAttendance(req: Request, res: Response) {
    try {
      const { emp_id, date_time, entry_mode } = req.body;
      if (!emp_id || !date_time || !entry_mode) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "emp_id, date_time, and entry_mode are required",
        });
        return;
      }
      if (entry_mode !== "In" && entry_mode !== "Out") {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "entry_mode must be 'In' or 'Out'",
        });
        return;
      }
      const data = await attendanceRepo.recordEntry({ emp_id, date_time, entry_mode });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Attendance recorded successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to record attendance",
      });
    }
  }

  public async getMyAttendance(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const date = req.query.date as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const result = await attendanceRepo.getMyAttendance(user_id, date, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Attendance fetched successfully",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch attendance",
      });
    }
  }
}
