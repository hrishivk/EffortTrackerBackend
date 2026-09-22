import express, { Router } from "express";
import { SuperAdminController } from "../controllers/super-admin.controller";
import { roleGuards } from "../middlewares/verifyRole";
import { ReportController } from "../controllers/report.controller";

export class SuperAdminRoute {
  private router: Router = express.Router();
  private controller = new SuperAdminController();
  private reportController = new ReportController();

  constructor() {
    this.router.post("/add-user", roleGuards.AdminOrSuperAdmin, this.controller.user);
    this.router.get("/list-users", roleGuards.AdminOrSuperAdmin, this.controller.fetchUsers);
    this.router.get("/user", roleGuards.allAcess, this.controller.getUser);
    this.router.get("/user-details", roleGuards.AdminOrSuperAdmin, this.controller.getUserDetails);
    this.router.patch("/edit-user", roleGuards.AdminOrSuperAdmin, this.controller.updateUser);
    this.router.patch("/reset-user-password", roleGuards.AdminOrSuperAdmin, this.controller.resetUserPassword);
    this.router.delete("/delete-user", roleGuards.AdminOrSuperAdmin, this.controller.deleteUser);
    this.router.patch("/block-user", roleGuards.SuperAdmin, this.controller.blockUser);
    this.router.patch("/unblock-user", roleGuards.SuperAdmin, this.controller.unBlock);
    this.router.post("/domain", roleGuards.AdminOrSuperAdmin, this.controller.upsertDomain);
    this.router.get("/list-domains", roleGuards.AdminOrSuperAdmin, this.controller.fetchDomain);
    this.router.delete("/domain", roleGuards.AdminOrSuperAdmin, this.controller.deleteDomain);
    this.router.get("/project-stats", roleGuards.AdminOrSuperAdmin, this.controller.projectStats);
    this.router.get("/project", roleGuards.AdminOrSuperAdmin, this.controller.fetchProject);
    this.router.post("/project", roleGuards.AdminOrSuperAdmin, this.controller.upsertProject);
    // The edit modal's save. POST /project is the wizard's create-or-replace and
    // requires name + domain_id every time; this one writes only the keys sent.
    this.router.patch("/project", roleGuards.AdminOrSuperAdmin, this.controller.patchProject);
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

    // The same two report routes as /role-am, so an SP opens the page at the
    // prefix their screens already use. Identical handlers: the prefix says
    // which screen, ReportService says who may read what.
    this.router.get("/reports/user", roleGuards.allAcess, this.reportController.userReport);
    this.router.get("/reports/team", roleGuards.allAcess, this.reportController.teamReport);
  }

  public getRouter(): Router {
    return this.router;
  }      
}
