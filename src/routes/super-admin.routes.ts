import express, { Router } from "express";
import { SuperAdminController } from "../controllers/super-admin.controller";
import { roleGuards } from "../middlewares/verifyRole";

export class SuperAdminRoute {
  private router: Router = express.Router();
  private controller = new SuperAdminController();

  constructor() {
    this.router.post("/add-user", this.controller.user);
    this.router.get("/list-users", roleGuards.AdminOrSuperAdmin, this.controller.fetchUsers);
    this.router.get("/user", roleGuards.allAcess, this.controller.getUser);
    this.router.patch("/edit-user", roleGuards.SuperAdmin, this.controller.updateUser);
    this.router.delete("/delete-user", roleGuards.AdminOrSuperAdmin, this.controller.deleteUser);
    this.router.patch("/block-user", roleGuards.SuperAdmin, this.controller.blockUser);
    this.router.patch("/unblock-user", roleGuards.SuperAdmin, this.controller.unBlock);
    this.router.post("/domain", roleGuards.AdminOrSuperAdmin, this.controller.upsertDomain);
    this.router.get("/list-domains", roleGuards.AdminOrSuperAdmin, this.controller.fetchDomain);
    this.router.delete("/domain", roleGuards.AdminOrSuperAdmin, this.controller.deleteDomain);
    this.router.get("/project-stats", roleGuards.AdminOrSuperAdmin, this.controller.projectStats);
    this.router.post("/project", roleGuards.AdminOrSuperAdmin, this.controller.upsertProject);
    this.router.patch("/project-status", roleGuards.AdminOrSuperAdmin, this.controller.updateProjectStatus);
    this.router.delete("/project", roleGuards.AdminOrSuperAdmin, this.controller.deleteProject);
    this.router.get("/project-domain", roleGuards.AdminOrSuperAdmin, this.controller.fetchDomainProject);
    this.router.post("/project-members", roleGuards.AdminOrSuperAdmin, this.controller.assignMembers);
    this.router.delete("/project-members", roleGuards.AdminOrSuperAdmin, this.controller.removeMembers);
    this.router.get("/project-members", roleGuards.AdminOrSuperAdmin, this.controller.getMembers);
    this.router.get("/task-count", roleGuards.AdminOrSuperAdmin, this.controller.getTaskCount);
    this.router.get("/task-completion-trend", roleGuards.AdminOrSuperAdmin, this.controller.getTaskCompletionTrend);
    this.router.get("/team-performance", roleGuards.AdminOrSuperAdmin, this.controller.getTeamPerformance);
    this.router.get("/recent-activity", roleGuards.AdminOrSuperAdmin, this.controller.getRecentActivity);
    this.router.get("/upcoming-deadlines", roleGuards.AdminOrSuperAdmin, this.controller.getUpcomingDeadlines);
  }

  public getRouter(): Router {
    return this.router;
  }      
}
