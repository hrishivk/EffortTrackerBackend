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
import {
  DateRange,
  DateRangeError,
  parseDateRange,
  parseOptionalDateOnly,
} from "../utils/dateRange";
const UserService = new userService();
const SuperAdminService = new superAdminService();
const leaveService = new LeaveService();
const taskGroupService = new TaskGroupService();
const taskCommentService = new TaskCommentService();
const notificationRepo = new NotificationRepository();
const attendanceRepo = new AttendanceRepository();

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
    message.startsWith("Nothing to update") ||
    message.startsWith("assigned_to")
  )
    return HTTP_statusCode.BadRequest;
  return HTTP_statusCode.InternalServerError;
};


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
        room_id,
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
      const { date, from, to, assigned_to, project, status, page = "1", limit = "10", extended, min_extensions } = req.query;

      // "What has slipped, and why" in one request. Two spellings of one
      // filter: `?extended=true` is the common case and means at least one
      // push; `?min_extensions=2` is the badge case — tasks pushed more than
      // once. An explicit min wins if both arrive.
      let minExtensions: number | undefined;
      if (min_extensions !== undefined) {
        const parsed = Math.floor(Number(min_extensions));
        if (Number.isFinite(parsed) && parsed >= 1) minExtensions = parsed;
      } else if (extended !== undefined) {
        const flag = String(extended).trim().toLowerCase();
        if (flag === "true" || flag === "1") minExtensions = 1;
      }
      const id = req.user?.id;
      const role = req.user?.role;

      let range: DateRange | undefined;
      let day: string | undefined;
      try {
        if (from !== undefined || to !== undefined) {
          range = parseDateRange(from, to);
        } else {
          day = parseOptionalDateOnly(date, "date");
        }
      } catch (error: unknown) {
        if (error instanceof DateRangeError) {
          sendResponse(res, HTTP_statusCode.BadRequest, {
            success: false,
            message: error.message,
          });
          return;
        }
        throw error;
      }

      const result = await UserService.listTask({
        date: day, range, id, role, assigned_to, project, status,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        minExtensions,
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
      const body = req.body ?? {};
      const payload: TaskStatusUpdate = { id };
      if ("status" in body) payload.status = body.status;
      if ("group_id" in body) payload.group_id = body.group_id;
      // Key-presence, not truthiness, on every one of these: the service reads
      // `undefined` as "leave unchanged" and an explicit null on a date as
      // "clear it", and `if (body.start_date)` would collapse the two.
      if ("description" in body) payload.description = body.description;
      if ("priority" in body) payload.priority = body.priority;
      if ("start_date" in body) payload.start_date = body.start_date;
      if ("due_date" in body) payload.due_date = body.due_date;
      if ("tags" in body) payload.tags = body.tags;
      if ("sequential" in body) payload.sequential = body.sequential;

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
        "Nothing to update: send status, group_id or an edited field":
          HTTP_statusCode.BadRequest,
      };
      const statusCode =
        error.name === "SequentialBlockedError" ||
        error.name === "SubtaskOpenError"
          ? HTTP_statusCode.Conflict
          : // Every content-edit rejection: empty description, bad priority,
            // unparseable date, due before start, sequential on a subtask.
            error.name === "TaskValidationError"
            ? HTTP_statusCode.BadRequest
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

  public async extendTask(req: Request, res: Response) {
    try {
      const body = req.body ?? {};
      const data = await UserService.extendTask({
        task_id: body.task_id,
        due_date: body.due_date,
        reason: body.reason,
        user: { id: req.user?.id, role: req.user?.role },
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Task extended successfully",
        data,
      });
    } catch (error: any) {
      const message = String(error.message ?? "");
      const statusCode =
        error.name === "TaskForbiddenError"
          ? HTTP_statusCode.NoAccess
          : error.name === "TaskValidationError"
          ? HTTP_statusCode.BadRequest
          : message === "Task not found"
          ? HTTP_statusCode.NotFound
          : message === "User not authenticated"
          ? HTTP_statusCode.unAuthorized
          : message === "Task is locked. Cannot extend." ||
            message === "Daily log is locked. Cannot extend task."
          ? HTTP_statusCode.locked
          : HTTP_statusCode.TaskFailed;
      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task extension failed",
      });
    }
  }

  // DELETE /role-user/task?id=<taskId> — remove a task, or one subtask.
  //
  // Irreversible, and a main task takes its subtasks with it, so the response
  // reports exactly what went: the frontend confirms BEFORE calling, and the
  // returned ids are what it drops from the list.
  public async deleteTask(req: Request, res: Response) {
    try {
      const id = req.query.id as string;
      if (!id) {
        sendResponse(res, HTTP_statusCode.BadRequest, {
          success: false,
          message: "Task id is required",
        });
        return;
      }
      const data = await UserService.deleteTask({
        id,
        user: { id: req.user?.id, role: req.user?.role },
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: data.deleted_subtasks
          ? `Task deleted with ${data.deleted_subtasks} subtask${
              data.deleted_subtasks === 1 ? "" : "s"
            }`
          : "Task deleted successfully",
        data,
      });
    } catch (error: any) {
      const message = String(error.message ?? "");
      const statusCode =
        error.name === "TaskForbiddenError"
          ? HTTP_statusCode.NoAccess
          : error.name === "TaskValidationError"
          ? HTTP_statusCode.BadRequest
          : message === "Task not found"
          ? HTTP_statusCode.NotFound
          : message === "User not authenticated"
          ? HTTP_statusCode.unAuthorized
          : message === "Task is locked. Cannot delete." ||
            message === "Daily log is locked. Cannot delete task."
          ? HTTP_statusCode.locked
          : HTTP_statusCode.TaskFailed;
      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Task delete failed",
      });
    }
  }


  public async addSubtask(req: Request, res: Response) {
    try {
      const body = req.body ?? {};
      const data = await UserService.addSubtask({
        parent_id: body.parent_id,
        description: body.description,
        assigned_to: body.assigned_to,

        created_by: body.created_by ?? req.user?.id,
        priority: body.priority,
        start_date: body.start_date,
        due_date: body.due_date,
        tags: body.tags,
        position: body.position,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "Subtask added successfully",
        data,
      });
    } catch (error: any) {
      const message = String(error.message ?? "");
      const isLocked =
        message === "Daily log is locked. Cannot add new task." ||
        message === "Task is locked. Cannot add a subtask.";
      const isBadRequest =
        error.name === "TaskValidationError" ||
        error.name === "SubtaskValidationError";
      const statusCode = isLocked
        ? HTTP_statusCode.locked
        : message === "Parent task not found"
        ? HTTP_statusCode.NotFound
        : isBadRequest
        ? HTTP_statusCode.BadRequest
        : HTTP_statusCode.TaskFailed;
      sendResponse(res, statusCode, {
        success: false,
        message: error.message || "Subtask creation failed",
      });
    }
  }

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
  public async listAllTaskGroups(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const assigned_to = req.query.assigned_to as string | undefined;
      const data = await taskGroupService.listAllGroups(
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
