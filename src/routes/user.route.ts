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
  }
  public getRouter(): Router {
    return this.router;
  }
}
