import express, { Router } from "express";
import { userController } from "../controllers/user.Controller";

export class UserRoute {
  private router: Router = express.Router();
  private controller = new userController();

  constructor() {
    this.router.post("/task", this.controller.task);
    this.router.get("/task-list", this.controller.taskList);
    this.router.patch("/task-lock", this.controller.taskLock);
    this.router.patch("/updateTask", this.controller.statusUpdate);

    this.router.all("*", (req, res) => {
      res.status(404).json({ message: "Route not found in UserRoute" });
    });
  }

  public getRouter(): Router {
    return this.router;
  }
}
