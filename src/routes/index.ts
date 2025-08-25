import { Application } from "express";
import { AuthRoute } from "./auth.routes";
import { spRoute } from "./super-admin.routes";
import { amRoute } from "./admin-manager.route";
import { UserRoute } from "./user.route";

export class allMain {
  static route(app: Application): void {
    // Initialize route instances
    const authRoute = new AuthRoute();
    const superAdminRoute = new spRoute();
    const adminManager = new amRoute();
    const userRoute = new UserRoute();

    // Mount routers with consistent, relative paths (never full URLs)
    app.use("/auth-role", authRoute.getRouter());
    app.use("/auth-role-sp", superAdminRoute.getRouter());
    app.use("/auth-role-am", adminManager.getRouter()); // lowercase path
    app.use("/user", userRoute.getRouter());
  }
}
