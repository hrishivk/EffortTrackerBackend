import expres, { Router } from "express";
import { managerController } from "../controllers/admin-manager.controller";
import { SuperAdminController } from "../controllers/super-admin.controller";
import { roleGuards } from "../middlewares/verifyRole";
import { ReportController } from "../controllers/report.controller";
export class amRoute {
  private router: Router = expres.Router();
  private controller = new managerController();
  private spController = new SuperAdminController();
  private reportController = new ReportController();

  constructor() {
    // list-users moved to /role-sp/list-users (works for both SP and AM)

    // Domain management for AM (shares controller with /role-sp; behavior branches on role)
    this.router.post("/domain", roleGuards.AdminOrSuperAdmin, this.spController.upsertDomain);
    this.router.get("/list-domains", roleGuards.AdminOrSuperAdmin, this.spController.fetchDomain);
    this.router.delete("/domain", roleGuards.AdminOrSuperAdmin, this.spController.deleteDomain);

    // The by-id project read, mounted here too so /role-am mirrors /role-sp.
    // Same controller, same guard, same per-project visibility rule inside —
    // an AM calling either path gets identical results. The alias exists so the
    // client does not have to special-case its base path for one endpoint.
    this.router.get("/project", roleGuards.AdminOrSuperAdmin, this.spController.fetchProject);
    this.router.patch("/project", roleGuards.AdminOrSuperAdmin, this.spController.patchProject);

    // Team leave history (AM only)
    this.router.get("/leave/team-leaves/export", roleGuards.Admin, this.controller.exportTeamLeaves);
    this.router.get("/leave/team-leaves", roleGuards.Admin, this.controller.getTeamLeaves);
    this.router.get("/team-members", roleGuards.Admin, this.controller.listTeamMembers);

    this.router.get("/reports/user", roleGuards.allAcess, this.reportController.userReport);
    this.router.get("/reports/team", roleGuards.allAcess, this.reportController.teamReport);
  }
  public getRouter(): Router {
    return this.router;
  }
}
