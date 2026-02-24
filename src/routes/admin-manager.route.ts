import expres, { Router } from "express";
import { managerController } from "../controllers/admin-manager.controller";
import { roleGuards } from "../middlewares/verifyRole";
export class amRoute {
  private router: Router = expres.Router();
  private controller = new managerController();

  constructor() {
    // list-users moved to /role-sp/list-users (works for both SP and AM)
  }
  public getRouter(): Router {
    return this.router;
  }
}
