import expres,{ Application,Router  } from "express";
import { userController } from "../controllers/user.Controller";
import  { roleGuards } from "../middlewares/verifyRole";


export class UserRoute{
  private router:Router =expres.Router()
  private controller=new userController()
 constructor(){

     this.router.post("/task",this.controller.task)
     this.router.get("/task-list",this.controller.taskList)
     this.router.patch("/task-lock",this.controller.taskLock)
     this.router.patch("/updateTask",this.controller.statusUpdate)
 }
 public getRouter():Router{
    return this.router
  }


}