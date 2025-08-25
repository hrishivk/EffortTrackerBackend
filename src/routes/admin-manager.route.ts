import express, { Router } from "express";
import { managerController } from "../controllers/admin-manager.controller";
import { roleGuards } from "../middlewares/verifyRole";

export class amRoute {
  private router: Router = express.Router();
  private controller = new managerController();

  constructor() {
    this.router.get("/list-am-User", roleGuards.Admin, this.controller.listAllUsers);

    this.router.all("*", (req, res) => {
      res.status(404).json({ message: "Route not found in AdminManagerRoute" });
    });
  }

  public getRouter(): Router {
    return this.router;
  }
}
