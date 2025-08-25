import express, { Router } from "express";
import { SuperAdminController } from "../controllers/super-admin.controller";
import { roleGuards } from "../middlewares/verifyRole";
import upload from "../middlewares/upload";

export class spRoute {
  private router: Router = express.Router();
  private controller = new SuperAdminController();

  constructor() {

    // this.router.use(verifyRole(['SP','AM']));

    this.router.post("/addDomain", this.controller.createDomain);
    this.router.get("/list-domain", this.controller.fetchDomain);
    this.router.get("/list-projects", this.controller.fetchProject);
    this.router.post("/addProject", this.controller.createProject);
    this.router.get("/list-User",this.controller.fetchUsers);
    this.router.get("/user",this.controller.getUser);
    this.router.get("/task-count",this.controller.getTaskCount);
    this.router.get("/delete-user",this.controller.deleteUser);
    this.router.patch("/unBlock-user",this.controller.unBlock);
    this.router.patch("/block-user",this.controller.blockUser);
    this.router.post("/edit-user", upload.single('profile'),this.controller.updateUser);
  }

  public getRouter(): Router {
    return this.router;
  }
}
