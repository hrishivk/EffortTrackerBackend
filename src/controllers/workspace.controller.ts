import { Request, Response } from "express";
import { sendResponse } from "../utils/sendResponse";
import HTTP_statusCode from "../Enums/statuCode";
import { WorkspaceService } from "../service/workspace.service";
import { STALE_SESSION } from "../repositories/workspace.repository";

const workspaceService = new WorkspaceService();

// Deliberately NOT HTTP_statusCode.TaskFailed (304). A 304 carries no body, so
// the message below would never reach the caller's snackbar, and axios does not
// treat it as an error — a failed create can look like it succeeded. Every
// failure here gets a real 4xx/5xx.
// Anything the database raised and nobody translated. Its message names tables
// and constraints, so it is replaced rather than forwarded — the service
// converts the cases that DO have a meaningful answer (a duplicate code becomes
// a 409, a vanished caller becomes STALE_SESSION) before they reach here.
const OPAQUE_FAILURE = "Something went wrong. Please try again";

const publicMessage = (error: any): string => {
  if (typeof error?.name === "string" && error.name.startsWith("Sequelize")) {
    return OPAQUE_FAILURE;
  }
  return error?.message || OPAQUE_FAILURE;
};

const workspaceErrorCode = (message?: string): HTTP_statusCode => {
  if (!message) return HTTP_statusCode.InternalServerError;

  // The caller's user row is gone mid-session. Not a 500: there is a specific
  // thing they can do about it.
  if (message === STALE_SESSION) return HTTP_statusCode.unAuthorized;

  // "Workspace not found" now covers three cases that must be indistinguishable
  // from each other: no such id, a PRIVATE workspace the caller is not in, and
  // another AM's workspace. A 403 on any of them would confirm the workspace
  // exists, which is how a key-guessing attack enumerates them.
  if (
    message === "Workspace not found" ||
    message === "Room not found" ||
    message === "Project not found" ||
    message === "Membership not found"
  )
    return HTTP_statusCode.NotFound;

  if (
    message === "A workspace with that code already exists" ||
    // Announcing a workspace that is not finished. 409 rather than 400: the
    // request is well formed, the workspace is simply in the wrong state.
    message === "Workspace is not completed"
  )
    return HTTP_statusCode.Conflict;

  // Only the join endpoint is throttled — the one place a wrong guess is cheap.
  if (message.startsWith("Too many join attempts"))
    return HTTP_statusCode.TooManyRequests;

  // Reached only when the caller's ROLE forbids the write outright. A plain
  // user gets a 403 for attempting to manage any workspace at all; which
  // workspaces exist is still not disclosed.
  if (message.startsWith("Not authorized")) return HTTP_statusCode.NoAccess;

  // Everything the validators raise is a bad payload.
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
  // GET /role-user/workspaces          — the workspaces this caller should see
  // GET /role-user/workspaces?id=<id>  — one workspace, project and rooms
  //                                      with their members embedded
  //
  // One handler for both, matching the ?id= convention /task-groups uses.
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

      // A private workspace the caller may not read comes back as a locked
      // stub on a 200, not a 403: the lock screen needs the workspace's name
      // to say which one it is asking about, and a 403 carries nothing to
      // render. success stays true — the request succeeded, the answer is
      // "locked".
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

  // POST /role-user/workspaces — the one call the wizard makes. Creates the
  // workspace, its rooms and every assignment in a single transaction.
  //
  // created_by comes from the session; a `created_by` in the payload is ignored.
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

  // PATCH /role-user/workspaces?id=<id>
  // GET /role-user/workspaces/notify-targets
  //
  // The options for the completion button's manager picker. Returning the
  // resolved set is what keeps the button from producing a 400: the client can
  // only offer ids the server already accepts.
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

  // POST /role-user/workspaces/notify-completed
  //
  // The Announce it strip. Separate from the status change on purpose:
  // completing a workspace tells nobody, and who should hear about it is a
  // judgement the person finishing the work makes.
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

      // Only forward keys the client actually sent, so renaming a workspace
      // does not blank its description or detach its project.
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

  // DELETE /role-user/workspaces?id=<id> — cascades to rooms and members.
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

  // POST /role-user/rooms
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

  // PATCH /role-user/rooms?id=<id>
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

  // DELETE /role-user/rooms?id=<id> — cascades to its members.
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

  // POST /role-user/room-members — a MOVE, not an insert: the user leaves
  // whichever room they were in within this workspace. Returns the destination
  // room with its members, so the board can redraw from the response.
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

  // DELETE /role-user/room-members?room_id=<id>&user_id=<id>
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

  // GET /role-user/rooms?id=<id> — one room with its active members and task
  // counts. 404 for a room the caller is not an active member of, matching the
  // room scoping on the workspace read.
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

  // POST /role-user/workspaces/join — { key, room_id? }
  //
  // A correct key creates a PENDING request; it does not grant access. The
  // three success shapes are distinguished by status code so the client knows
  // whether to show "waiting for approval" or navigate into the workspace:
  //
  //   201 requested        a new pending request
  //   200 already_pending  a request was already waiting — no second row
  //   200 already_member   already active; the workspace comes back
  public async joinWorkspace(req: Request, res: Response) {
    try {
      const callerId = req.user?.id as string;
      const { outcome, data } = await workspaceService.joinWithKey(
        callerId,
        req.user?.role,
        req.body ?? {},
        req.user?.sid
      );

      // Two payload shapes reach here: the thin join view (`data.workspace.name`)
      // when a room request was queued, and the workspace itself (`data.name`)
      // when none was needed because the caller is already a member.
      const name = data?.workspace?.name ?? data?.name ?? "workspace";

      // Whether a manager still has to act. Absent on the workspace-shaped
      // payload, which is exactly the case where nothing is pending.
      const roomPending = data?.room_pending === true;

      const message =
        outcome === "already_member"
          ? `${name} is already open for this session`
          : outcome === "already_pending"
          ? `${name} unlocked for this session — your room request is still awaiting approval`
          : outcome === "unlocked"
          ? roomPending
            ? `${name} unlocked for this session — room access is awaiting manager approval`
            : // An existing member unlocking: they already have their rooms, so
              // there is nothing to approve.
              `${name} unlocked for this session`
          : // "requested": the key was right but there was no session to scope
            // an unlock to, so say only what actually happened.
            "join request sent — waiting for manager approval";

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

  // GET /role-user/room-members?workspace_id=<id>&status=pending
  //
  // The manager's approval queue. `status` is optional; omitting it returns
  // every membership row for the workspace.
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

  // PATCH /role-user/room-members?room_id=<id>&user_id=<id> — { status }
  //
  // Approve ("active") or decline ("rejected") a join request. Stamps
  // decided_by/decided_at and returns the room with its members, so the queue
  // and the room card can both redraw from the response.
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
