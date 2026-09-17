import expres, { Application, Router } from "express";
import { userController } from "../controllers/user.Controller";
import { roleGuards } from "../middlewares/verifyRole";
import { WorkspaceController } from "../controllers/workspace.controller";
import { ReportController } from "../controllers/report.controller";
export class UserRoute {
  private router: Router = expres.Router();
  private controller = new userController();
  private workspaceController = new WorkspaceController();
  private reportController = new ReportController();
  constructor() {
    this.router.get("/list-projects", roleGuards.allAcess, this.controller.listProjects);
    this.router.post("/task", roleGuards.allAcess, this.controller.task);
    this.router.get("/task-list", roleGuards.allAcess, this.controller.taskList);
    this.router.patch("/task-lock", roleGuards.allAcess, this.controller.taskLock);
    this.router.patch("/updateTask", roleGuards.allAcess, this.controller.statusUpdate);

    // Task comments — on the tasks row, not a table of their own. A subtask is
    // already a row in tasks, so one column covers the main task and any
    // subtask alike.
    //
    // No GET on purpose: comments come back nested inside /task-list. These
    // three writes exist rather than letting the client PATCH the array
    // because a whole-array write from a browser loses comments that landed
    // concurrently and lets anyone rewrite someone else's.
    //
    // allAcess here, narrowed in TaskCommentService to "anyone who can read
    // the task" — the same rule /task-list applies — so a 403 arrives inside
    // the { success, message } envelope rather than as the middleware's bare
    // { error }.
    this.router.post("/task-comment", roleGuards.allAcess, this.controller.addTaskComment);
    this.router.patch("/task-comment", roleGuards.allAcess, this.controller.updateTaskComment);
    this.router.delete("/task-comment", roleGuards.allAcess, this.controller.deleteTaskComment);

    // Board Groups — a group lane lives alongside the four status lanes
    // Registered before the single-board route so the literal path is never
    // read as anything else if /task-groups ever gains a :param form.
    this.router.get("/task-groups/all", roleGuards.allAcess, this.controller.listAllTaskGroups);
    this.router.get("/task-groups", roleGuards.allAcess, this.controller.listTaskGroups);
    this.router.post("/task-groups", roleGuards.allAcess, this.controller.createTaskGroup);
    this.router.patch("/task-groups", roleGuards.allAcess, this.controller.updateTaskGroup);
    this.router.delete("/task-groups", roleGuards.allAcess, this.controller.deleteTaskGroup);

    // Workspaces / Rooms / Room members — backs /:role/workspace-setup.
    //
    // Mounted on /role-user (like /task-groups and /list-projects) rather than
    // branched per role: SP and AM both open the wizard. The guard here is
    // allAcess so a room member can READ the workspace they were assigned to;
    // the SP/AM-only rule for writes is enforced in WorkspaceService, which
    // keeps a 403 inside the { success, message } envelope instead of the
    // middleware's bare { error }.

    // The manager picker behind the "mark completed" button next to the
    // workspace status. Registered BEFORE /workspaces so the literal path is
    // never read as a workspace id by a future /workspaces/:id route.
    //
    // allAcess here and narrowed to SP/AM in the service, like every other
    // workspace write: only those two can complete a workspace, so only they
    // have any use for the list.
    this.router.get("/workspaces/notify-targets", roleGuards.allAcess, this.workspaceController.getNotifyTargets);

    // The Announce it strip. The one route in the app where the CLIENT raises a
    // notification rather than reading one, so the service validates hard and
    // writes nothing on a bad request.
    this.router.post("/workspaces/notify-completed", roleGuards.allAcess, this.workspaceController.notifyCompleted);

    this.router.get("/workspaces", roleGuards.allAcess, this.workspaceController.getWorkspaces);
    this.router.post("/workspaces", roleGuards.allAcess, this.workspaceController.createWorkspace);
    this.router.patch("/workspaces", roleGuards.allAcess, this.workspaceController.updateWorkspace);
    this.router.delete("/workspaces", roleGuards.allAcess, this.workspaceController.deleteWorkspace);

    // Join with a workspace key. allAcess by design — this is the one workspace
    // endpoint meant for someone who is NOT yet a member. A correct key creates
    // a pending request, so reaching it grants nothing on its own; the service
    // rate-limits it per user.
    this.router.post("/workspaces/join", roleGuards.allAcess, this.workspaceController.joinWorkspace);

    this.router.get("/rooms", roleGuards.allAcess, this.workspaceController.getRooms);
    this.router.post("/rooms", roleGuards.allAcess, this.workspaceController.createRoom);
    this.router.patch("/rooms", roleGuards.allAcess, this.workspaceController.updateRoom);
    this.router.delete("/rooms", roleGuards.allAcess, this.workspaceController.deleteRoom);

    // GET and PATCH are the manager's approval queue. Guarded by allAcess here
    // and narrowed to SP/AM in the service, same as the other writes, so a 403
    // arrives inside the { success, message } envelope.
    this.router.get("/room-members", roleGuards.allAcess, this.workspaceController.getRoomMembers);
    this.router.post("/room-members", roleGuards.allAcess, this.workspaceController.addRoomMember);
    this.router.patch("/room-members", roleGuards.allAcess, this.workspaceController.decideRoomMember);
    this.router.delete("/room-members", roleGuards.allAcess, this.workspaceController.removeRoomMember);

    // Leave Management
    this.router.post("/leave/apply", roleGuards.allAcess, this.controller.applyLeave);
    this.router.get("/leave/my-leaves", roleGuards.allAcess, this.controller.getMyLeaves);
    this.router.get("/leave/balance", roleGuards.allAcess, this.controller.getLeaveBalance);
    this.router.get("/leave/pending-manager", roleGuards.AdminOrManager, this.controller.getPendingForManager);
    this.router.patch("/leave/manager-action", roleGuards.AdminOrManager, this.controller.managerAction);
    this.router.get("/leave/pending-admin", roleGuards.AdminOrSuperAdmin, this.controller.getPendingForAdmin);
    this.router.patch("/leave/admin-action", roleGuards.AdminOrSuperAdmin, this.controller.adminAction);
    this.router.patch("/leave/cancel", roleGuards.allAcess, this.controller.cancelLeave);

    // Notifications
    this.router.get("/notifications", roleGuards.allAcess, this.controller.getNotifications);
    this.router.get("/notifications/count", roleGuards.allAcess, this.controller.getNotificationCount);
    this.router.patch("/notifications/read", roleGuards.allAcess, this.controller.markNotificationRead);
    this.router.patch("/notifications/read-all", roleGuards.allAcess, this.controller.markAllNotificationsRead);

    // Attendance
    this.router.post("/attendance", this.controller.recordAttendance);
    this.router.get("/attendance/my", roleGuards.allAcess, this.controller.getMyAttendance);
    // The individual report (§1), at the prefix a USER or DEVLOPER already
    // uses. Same handler as /role-am and /role-sp: the prefix says which
    // screen, ReportService says who may read whose numbers. Without this a
    // person could not open their own report without calling a manager route.
    //
    // No team report here on purpose — a USER manages nobody, and §3 answers
    // that with a 403 rather than a team of one.
    this.router.get("/reports/user", roleGuards.allAcess, this.reportController.userReport);
  }
  public getRouter(): Router {
    return this.router;
  }
}
