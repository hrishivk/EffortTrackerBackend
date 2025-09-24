import expres,{ Router  } from "express";
import { managerController } from "../controllers/admin-manager.controller";
import  { roleGuards } from "../middlewares/verifyRole";
export class amRoute{
  private router:Router =expres.Router()
  private controller=new managerController()
 
 constructor(){
   this.router.get("/list-am-User",this.controller.listAllUsers)
 }
 public getRouter():Router{
    return this.router
  }


}