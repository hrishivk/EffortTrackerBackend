import expres,{ Application,Router  } from "express";
import { AuthController } from "../controllers/auth.controller";



export class AuthRoute{
  private router:Router =expres.Router()
  private controller=new AuthController()

 constructor(){
     this.router.post("/login",this.controller.login)
     this.router.post('/addUser',this.controller.user)
     this.router.post("/logout",this.controller.logOut)
 }
 public getRouter():Router{
    return this.router
  }


}