import { Application } from "express";
import { AuthRoute } from "./auth.routes";
import { SuperAdminRoute } from "./super-admin.routes";
import { amRoute } from "./admin-manager.route";
import { UserRoute } from "./user.route";

export function registerRoutes(app: Application): void {
  app.use("/auth", new AuthRoute().getRouter());
  app.use("/role-sp", new SuperAdminRoute().getRouter());
  app.use("/role-am", new amRoute().getRouter());
  app.use("/role-user", new UserRoute().getRouter());
}