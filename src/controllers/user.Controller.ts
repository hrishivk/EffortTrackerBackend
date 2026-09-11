import { Request, Response, NextFunction } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { userService } from "../service/user.service";
import { TaskStatusUpdate } from "../types/task.types";
import { superAdminService } from "../service/super-admin.service";
import { LeaveService } from "../service/leave.service";
import { TaskGroupService } from "../service/task-group.service";
import {
  COMMENT_ERRORS,
  TaskCommentService,
} from "../service/task-comment.service";
import { NotificationRepository } from "../repositories/notification.repository";
import { AttendanceRepository } from "../repositories/attendance.repository";
const UserService = new userService();
const SuperAdminService = new superAdminService();
const leaveService = new LeaveService();
const taskGroupService = new TaskGroupService();
const taskCommentService = new TaskCommentService();
const notificationRepo = new NotificationRepository();
const attendanceRepo = new AttendanceRepository();

// Deliberately not HTTP_statusCode.TaskFailed (304): a 304 carries no body, so
// the message would never reach the caller's snackbar.
const taskGroupErrorCode = (message?: string): HTTP_statusCode => {
  if (!message) return HTTP_statusCode.InternalServerError;
  if (message === "Group not found") return HTTP_statusCode.NotFound;
  if (
    message === "A group with that name already exists" ||
    message === "A shared group with that name already exists"
  )
    return HTTP_statusCode.Conflict;
  if (message.startsWith("Not authorized")) return HTTP_statusCode.NoAccess;
  if (
    message.startsWith("Group name") ||
    message.startsWith("Group id") ||
    message.startsWith("Color must") ||
    message.startsWith("Position must") ||
    message.startsWith("Nothing to update")
  )
    return HTTP_statusCode.BadRequest;
  return HTTP_statusCode.InternalServerError;
};

// Same shape as taskGroupErrorCode above, and 304 is avoided here for the same
// reason: it carries no body, so the message would never reach the caller.
const taskCommentErrorCode = (message?: string): HTTP_statusCode => {
  if (!message) return HTTP_statusCode.InternalServerError;
  if (
    message === COMMENT_ERRORS.taskNotFound ||
    message === COMMENT_ERRORS.commentNotFound
  )
    return HTTP_statusCode.NotFound;
  if (
    message === COMMENT_ERRORS.notAuthorized ||
    message === COMMENT_ERRORS.notAuthor ||
    message === COMMENT_ERRORS.notDeletable
  )
    return HTTP_statusCode.NoAccess;
  if (
    message === COMMENT_ERRORS.emptyBody ||
    message === COMMENT_ERRORS.missingIds ||
    message === "task_id is required"
  )
    return HTTP_statusCode.BadRequest;
  if (message === "User not authenticated") return HTTP_statusCode.unAuthorized;
  return HTTP_statusCode.InternalServerError;
};

export class userController {
  public async task(req: Request, res: Response) {
    try {
      const { created_by, assigned_to, project, project_id, description, priority, end_time, start_date, due_date, status, tags, subtasks, parent_id, room_id, sequential } = req.body;
      const data = await UserService.addTask({
        created_by,
        assigned_to,
        project,
        project_id,
        description,
        priority,
        end_time,
        start_date,
        due_date,
        status,
        tags,
        subtasks,
        parent_id,
        // Sent by the room page alongside project_id, assigned_to, priority,
        // status and group_id. Omitted everywhere else, so it stays null.
        room_id,
        // The room's shared task: when true its subtasks run strictly in
        // position order. Omitted everywhere else, so it stays false and no
        // existing caller changes behaviour.
        sequential,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Task added successful",
        data,
      });
    } catch (error: any) {
      const isLocked =
        error.message === "Daily log is locked. Cannot add new task.";
      // A rejected subtask assignee has to arrive as a 400 with the message
      // intact. TaskFailed is 304, and a 304 carries no body, so the index of
      // the offending row would never reach the caller — which is the entire
      // reason the check names one.
      const isBadRequest =
        error.name === "SubtaskValidationError" ||
        error.message === "Room not found" ||
        error.message === "Either project or project_id is required" ||
        String(error.message).startsWith("Project ");
      const statusCode = isLocked
        ? HTTP_statusCode.locked
        : isBadRequest
        ? HTTP_statusCode.BadRequest
        : HTTP_statusCode.TaskFailed;
      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task creation failed",
      });
    }
  }
  public async taskList(req: Request, res: Response) {
    try {
      const { date, assigned_to, project, status, page = "1", limit = "10" } = req.query;
      const id = req.user?.id;
      const role = req.user?.role;
      const result = await UserService.listTask({
        date, id, role, assigned_to, project, status,
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
      const id = req.query.id as string;
      if (!id) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "Task id is required",
        });
        return;
      }

      // Read with `in` rather than a plain lookup so the drop payloads stay
      // distinguishable:
      //   drop on a status lane -> { status, group_id: null }  (unlinks group)
      //   drop on a group       -> { group_id }                (status untouched)
      // An absent key means "leave unchanged"; an explicit null means "clear".
      const body = req.body ?? {};
      const payload: TaskStatusUpdate = { id };
      if ("status" in body) payload.status = body.status;
      if ("group_id" in body) payload.group_id = body.group_id;

      const data = await UserService.updateStatus(payload);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task updated successfuly",
        data,
      });
    } catch (error: any) {
      console.log(error)
      const errorStatusMap: Record<string, number> = {
        "Daily log is locked. Cannot update task status.":
          HTTP_statusCode.locked,
        "A completed task cannot be reopened": HTTP_statusCode.Conflict,
        "A task must be started before it can be completed":
          HTTP_statusCode.Conflict,
        "A task must be completed before it can be moved to a group":
          HTTP_statusCode.Conflict,
        "A task in a group cannot be moved back to a status":
          HTTP_statusCode.Conflict,
        "A task in progress cannot go back to yet to start":
          HTTP_statusCode.Conflict,
        "Task not found": HTTP_statusCode.NotFound,
        "Group not found": HTTP_statusCode.NotFound,
        "Group belongs to a different board": HTTP_statusCode.BadRequest,
        "Nothing to update: send status, group_id or both":
          HTTP_statusCode.BadRequest,
      };

      // Section 4(a): starting a subtask out of turn on a sequential parent.
      // Matched on the error's name, not its message — the message is written
      // to be shown to the user as-is ("Build the UI can't start until Design
      // the screens is completed") and has to stay free to change.
      const statusCode =
        error.name === "SequentialBlockedError"
          ? HTTP_statusCode.Conflict
          : errorStatusMap[error.message] ||
            (String(error.message).startsWith("Invalid status")
              ? HTTP_statusCode.BadRequest
              : HTTP_statusCode.TaskFailed);

      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task status update failed",
      });
    }
  }
  // ── Task comments ─────────────────────────────────────────────────────────
  //
  // Three writes and no GET: comments travel inside /task-list. The writes are
  // server-side rather than letting the client PATCH the comments array
  // because a whole-array write from a browser both loses comments that landed
  // concurrently and lets anyone rewrite someone else's.
  public async addTaskComment(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const { task_id, body } = req.body ?? {};
      if (!task_id) throw new Error("task_id is required");

      const comment = await taskCommentService.addComment({
        task_id,
        body,
        user_id,
        role: req.user?.role,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Comment added successfully",
        data: comment,
      });
    } catch (error: any) {
      sendResponse(res, taskCommentErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to add comment",
      });
    }
  }

  public async updateTaskComment(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      const { task_id, comment_id, body } = req.body ?? {};

      const comment = await taskCommentService.editComment({
        task_id,
        comment_id,
        body,
        user_id,
        role: req.user?.role,
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Comment updated successfully",
        data: comment,
      });
    } catch (error: any) {
      sendResponse(res, taskCommentErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to update comment",
      });
    }
  }

  public async deleteTaskComment(req: Request, res: Response) {
    try {
      const user_id = req.user?.id;
      if (!user_id) throw new Error("User not authenticated");
      // Query params, not a body: DELETE with a body is refused or dropped by
      // enough proxies that it is not worth relying on.
      const task_id = req.query.task_id as string;
      const comment_id = req.query.comment_id as string;

      const result = await taskCommentService.deleteComment({
        task_id,
        comment_id,
        user_id,
        role: req.user?.role,
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Comment deleted successfully",
        data: result,
      });
    } catch (error: any) {
      sendResponse(res, taskCommentErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to delete comment",
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

  // ── Board Groups ──
  //
  // A group is a user-created lane on the board, scoped per user. A caller sees
  // their own groups; SP/AM can pass ?assigned_to=<userId> to get the groups of
  // a board they are allowed to view. That keeps the group list aligned with the
  // group_id values /task-list returns for that same board.

  public async listTaskGroups(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const assigned_to = req.query.assigned_to as string | undefined;
      const data = await taskGroupService.listGroups(
        callerId,
        req.user?.role,
        assigned_to
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task groups fetched successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, taskGroupErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to fetch task groups",
      });
    }
  }

  public async createTaskGroup(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const { name, color, position, assigned_to } = req.body ?? {};
      const data = await taskGroupService.createGroup(callerId, req.user?.role, {
        name,
        color,
        position,
        assigned_to,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Task group created successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, taskGroupErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to create task group",
      });
    }
  }

  public async updateTaskGroup(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const body = req.body ?? {};
      // Only forward keys the client actually sent, so a rename does not blank
      // out the group's color or reset its position.
      const patch: { name?: unknown; color?: unknown; position?: unknown } = {};
      if ("name" in body) patch.name = body.name;
      if ("color" in body) patch.color = body.color;
      if ("position" in body) patch.position = body.position;

      const data = await taskGroupService.updateGroup(
        callerId,
        req.user?.role,
        id,
        patch
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task group updated successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, taskGroupErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to update task group",
      });
    }
  }

  public async deleteTaskGroup(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const data = await taskGroupService.deleteGroup(
        callerId,
        req.user?.role,
        id
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task group deleted successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, taskGroupErrorCode(error.message), {
        success: false,
        message: error.message || "Failed to delete task group",
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
