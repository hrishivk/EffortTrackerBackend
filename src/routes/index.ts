import { Application } from "express";
import {AuthRoute} from "./auth.routes"
import {spRoute} from "./super-admin.routes"
import { amRoute } from "./admin-manager.route";
import { UserRoute } from "./user.route";


export class allMain{
    static route(app:Application):void{
        const authRoute = new  AuthRoute()
        const superAdminRoute = new spRoute()
        const adminManager=new amRoute()
        const userRoute=new UserRoute()
        app.use("/auth-role",authRoute.getRouter())
        app.use("/auth-role-sp",superAdminRoute.getRouter())
        app.use("/auth-role-Am",adminManager.getRouter())
        app.use("/user",userRoute.getRouter())
        
    }
}