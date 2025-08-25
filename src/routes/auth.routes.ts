import express, { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import upload from "../middlewares/upload";

export class AuthRoute {
  private router: Router = express.Router();
  private controller = new AuthController();

  constructor() {
    this.router.post("/login", this.controller.login);
    this.router.post("/addUser", upload.single("profile"), this.controller.user);
    this.router.post("/logout", this.controller.logOut);

    // Catch-all for unmatched paths
    this.router.all("*", (req, res) => {
      res.status(404).json({ message: "Route not found in AuthRoute" });
    });
  }

  public getRouter(): Router {
    return this.router;
  }
}
