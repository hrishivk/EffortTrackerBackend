import expres, { Application, Router } from "express";
import { userController } from "../controllers/user.Controller";
import { roleGuards } from "../middlewares/verifyRole";
export class UserRoute {
  private router: Router = expres.Router();
  private controller = new userController();
  constructor() {
    this.router.get("/list-projects", roleGuards.allAcess, this.controller.listProjects);
    this.router.post("/task", roleGuards.allAcess, this.controller.task);
    this.router.get("/task-list", roleGuards.allAcess, this.controller.taskList);
    this.router.patch("/task-lock", roleGuards.allAcess, this.controller.taskLock);
    this.router.patch("/updateTask", roleGuards.allAcess, this.controller.statusUpdate);

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
  }
  public getRouter(): Router {
    return this.router;
  }
}
