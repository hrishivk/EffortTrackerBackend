import expres, { Router } from "express";
import { managerController } from "../controllers/admin-manager.controller";
import { SuperAdminController } from "../controllers/super-admin.controller";
import { roleGuards } from "../middlewares/verifyRole";
export class amRoute {
  private router: Router = expres.Router();
  private controller = new managerController();
  private spController = new SuperAdminController();

  constructor() {
    // list-users moved to /role-sp/list-users (works for both SP and AM)

    // Domain management for AM (shares controller with /role-sp; behavior branches on role)
    this.router.post("/domain", roleGuards.AdminOrSuperAdmin, this.spController.upsertDomain);
    this.router.get("/list-domains", roleGuards.AdminOrSuperAdmin, this.spController.fetchDomain);
    this.router.delete("/domain", roleGuards.AdminOrSuperAdmin, this.spController.deleteDomain);

    // Team leave history (AM only)
    this.router.get("/leave/team-leaves/export", roleGuards.Admin, this.controller.exportTeamLeaves);
    this.router.get("/leave/team-leaves", roleGuards.Admin, this.controller.getTeamLeaves);
    this.router.get("/team-members", roleGuards.Admin, this.controller.listTeamMembers);
  }
  public getRouter(): Router {
    return this.router;
  }
}
