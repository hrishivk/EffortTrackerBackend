import { Request, Response } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { WorkspaceService } from "../service/workspace.service";
import { STALE_SESSION } from "../repositories/workspace.repository";

const workspaceService = new WorkspaceService();


const OPAQUE_FAILURE = "Something went wrong. Please try again";

const publicMessage = (error: any): string => {
  if (typeof error?.name === "string" && error.name.startsWith("Sequelize")) {
    return OPAQUE_FAILURE;
  }
  return error?.message || OPAQUE_FAILURE;
};

const workspaceErrorCode = (message?: string): HTTP_statusCode => {
  if (!message) return HTTP_statusCode.InternalServerError;

  if (message === STALE_SESSION) return HTTP_statusCode.unAuthorized;

  if (
    message === "Workspace not found" ||
    message === "Room not found" ||
    message === "Project not found" ||
    message === "Membership not found"
  )
    return HTTP_statusCode.NotFound;

  if (
    message === "A workspace with that code already exists" ||

    message === "Workspace is not completed"
  )
    return HTTP_statusCode.Conflict;
  if (message.startsWith("Too many join attempts"))
    return HTTP_statusCode.TooManyRequests;

  if (message.startsWith("Not authorized")) return HTTP_statusCode.NoAccess;


  if (
    message.startsWith("Workspace name") ||
    message.startsWith("Workspace code") ||
    message.startsWith("Workspace status") ||
    message.startsWith("Workspace visibility") ||
    message.startsWith("Workspace description") ||
    message.startsWith("Workspace id") ||
    message.startsWith("Workspace key") ||
    message.startsWith("Membership status") ||
    message.startsWith("Room name") ||
    message.startsWith("Room description") ||
    message.startsWith("Room id") ||
    message.startsWith("User id") ||
    message.startsWith("Position must") ||
    message.startsWith("At least one room") ||
    message.startsWith("A project is required") ||
    message.startsWith("Unknown user ids") ||
    message.startsWith("Nothing to update") ||
    message.startsWith("user_ids") ||
    message.startsWith("This workspace has no rooms") ||
    message.startsWith("Room \"")
  )
    return HTTP_statusCode.BadRequest;

  return HTTP_statusCode.InternalServerError;
};

export class WorkspaceController {
  public async getWorkspaces(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string | undefined;

      const data = id
        ? await workspaceService.getWorkspace(
            callerId,
            req.user?.role,
            id,
            req.user?.sid
          )
        : await workspaceService.listWorkspaces(
            callerId,
            req.user?.role,
            req.user?.sid
          );

  
      const locked = !Array.isArray(data) && (data as any)?.locked === true;

      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: locked ? "workspace is private" : "Workspaces fetched successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to fetch workspaces",
      });
    }
  }

 
  public async createWorkspace(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const data = await workspaceService.createWorkspace(
        callerId,
        req.user?.role,
        req.body ?? {}
      );
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "workspace created successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to create workspace",
      });
    }
  }


  public async getNotifyTargets(req: Request, res: Response) {
    try {
      const data = await workspaceService.listNotifyTargets(
        req.user?.id as string,
        req.user?.role
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "notify targets fetched successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to fetch notify targets",
      });
    }
  }

  public async notifyCompleted(req: Request, res: Response) {
    try {
      const data = await workspaceService.notifyCompleted(
        req.user?.id as string,
        req.user?.role,
        req.body ?? {}
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "workspace completion announced",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to announce workspace completion",
      });
    }
  }

  public async updateWorkspace(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      for (const key of [
        "name",
        "code",
        "status",
        "visibility",
        "description",
        "project_id",
      ]) {
        if (key in body) patch[key] = body[key];
      }

      const data = await workspaceService.updateWorkspace(
        callerId,
        req.user?.role,
        id,
        patch
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "workspace updated successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to update workspace",
      });
    }
  }

  public async deleteWorkspace(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const data = await workspaceService.deleteWorkspace(
        callerId,
        req.user?.role,
        id
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "workspace deleted successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to delete workspace",
      });
    }
  }


  public async createRoom(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const data = await workspaceService.createRoom(
        callerId,
        req.user?.role,
        req.body ?? {}
      );
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "room created successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to create room",
      });
    }
  }

  public async updateRoom(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if ("name" in body) patch.name = body.name;
      if ("description" in body) patch.description = body.description;
      if ("position" in body) patch.position = body.position;

      const data = await workspaceService.updateRoom(
        callerId,
        req.user?.role,
        id,
        patch
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "room updated successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to update room",
      });
    }
  }

  public async deleteRoom(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const data = await workspaceService.deleteRoom(
        callerId,
        req.user?.role,
        id
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "room deleted successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to delete room",
      });
    }
  }

 
  public async addRoomMember(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const data = await workspaceService.addRoomMember(
        callerId,
        req.user?.role,
        req.body ?? {}
      );
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "room member assigned successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to assign room member",
      });
    }
  }

  public async removeRoomMember(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const room_id = req.query.room_id as string;
      const user_id = req.query.user_id as string;
      const data = await workspaceService.removeRoomMember(
        callerId,
        req.user?.role,
        room_id,
        user_id
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "room member removed successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to remove room member",
      });
    }
  }
  public async getRooms(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const id = req.query.id as string;
      const data = await workspaceService.getRoom(
        callerId,
        req.user?.role,
        id,
        req.user?.sid
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "room fetched successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to fetch room",
      });
    }
  }


  public async joinWorkspace(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const { outcome, data } = await workspaceService.joinWithKey(
        callerId,
        req.user?.role,
        req.body ?? {},
        req.user?.sid
      );


      const name = data?.workspace?.name ?? data?.name ?? "workspace";

      const roomPending = data?.room_pending === true;

      const message =
        outcome === "already_member"
          ? `${name} is already open for this session`
          : outcome === "already_pending"
          ? `${name} unlocked for this session — your room request is still awaiting approval`
          : outcome === "unlocked"
          ? roomPending
            ? `${name} unlocked for this session — room access is awaiting manager approval`
            : `${name} unlocked for this session`
          : "join request sent — waiting for manager approval";

      sendResponse(
        res,
        outcome === "unlocked" || outcome === "requested"
          ? HTTP_statusCode.CREATED
          : HTTP_statusCode.OK,
        { success: true, message, data, outcome }
      );
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to join workspace",
      });
    }
  }


  public async getRoomMembers(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const workspace_id = req.query.workspace_id as string;
      const status = req.query.status as string | undefined;
      const data = await workspaceService.listRoomMembers(
        callerId,
        req.user?.role,
        workspace_id,
        status
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "room members fetched successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to fetch room members",
      });
    }
  }


  public async decideRoomMember(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const room_id = req.query.room_id as string;
      const user_id = req.query.user_id as string;
      const data = await workspaceService.decideRoomMember(
        callerId,
        req.user?.role,
        room_id,
        user_id,
        req.body ?? {}
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "membership updated successfully",
        data,
      });
    } catch (error: any) {
      const message = publicMessage(error);
      sendResponse(res, workspaceErrorCode(message), {
        success: false,
        message: message || "Failed to update membership",
      });
    }
  }
}
