import { Application, Request, Response, NextFunction } from "express";
import { AuthRoute } from "./auth.routes";
import { spRoute } from "./super-admin.routes";
import { amRoute } from "./admin-manager.route";
import { UserRoute } from "./user.route";

export class AllMain {
  static route(app: Application): void {
    // Initialize route instances
    const authRoute = new AuthRoute();
    const superAdminRoute = new spRoute();
    const adminManager = new amRoute();
    const userRoute = new UserRoute();

    app.use("/auth-role", authRoute.getRouter());
    app.use("/auth-role-sp", superAdminRoute.getRouter());
    app.use("/auth-role-am", adminManager.getRouter());
    app.use("/user", userRoute.getRouter());

    app.get("/health", (req: Request, res: Response) => {
      res.status(200).json({ status: "OK" });
    });

    app.all("*", (req: Request, res: Response) => {
      res.status(404).json({ message: "Route not found" });
    });

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error(err);
      res.status(500).json({ message: "Internal Server Error" });
    });
  }
}
