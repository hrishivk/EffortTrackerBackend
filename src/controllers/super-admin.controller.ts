import { Request, Response, NextFunction } from "express";
import { userService } from "../service/user.service";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import { superAdminService } from "../service/super-admin.service";

const SuperAdminService = new superAdminService();
export class SuperAdminController {
  public async createDomain(req: Request, res: Response) {
    try {
      const { name, description } = req.body;
      const data = await SuperAdminService.addDomain({ name, description });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Domain created successful",
        data,
      });
    } catch (error:any) {
      console.log(error.message)
       sendResponse(res, HTTP_statusCode.TaskFailed, {
        success: false,
        message: error.message || "Add Domain Failed",
      });
    }
  }
  public async fetchDomain(req: Request, res: Response) {
    try {
      const data = await SuperAdminService.getAllDomain();
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error:any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }
  }
  public async fetchProject(req:Request,res:Response){
    try {
     const data = await SuperAdminService.getAllProjects();
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error:any) {
       sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
      
    }
  }
  public async createProject(req:Request,res:Response){
    try {
      const {domain,name,description}=req.body
      console.log('domain',domain)
      const data= await SuperAdminService.addProject({domain,name,description})
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Project created successfull",
        data,
      });
    } catch (error:any) {
      console.log(error)
       sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "project creation failed",
      });
    }
  }
  public async fetchUsers(req:Request,res:Response){
    try {
   
      const data=await SuperAdminService.getAllUsers()
       sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error:any) {
       sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }

  }
  public async getUser(req:Request,res:Response){
    try {
      const {id}=req.query
      const data=await SuperAdminService.getUserById(id as string)
        sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error:any) {
    sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching user failed",
      });
    }

  }
  public async getTaskCount(req:Request,res:Response){
    try {
      const {role,date}=req.query
      const data=await SuperAdminService.countTask(role as string,date as string)
        sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Task counted successful",
         data,
      });
    } catch (error:any) {
    sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching user failed",
      });
    }

  }
  public async deleteUser(req:Request,res:Response){
    try {
      const {id}=req.query
      const data=await SuperAdminService.deletetUserById(id as string)
        sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error:any) {
    sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching user failed",
      });
    }

  }
  public async unBlock(req:Request,res:Response){
    try {
      const {id}=req.query
      const data=await SuperAdminService.unBlockUserById(id as string)
        sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "unblocked successfully",
        data,
      });
    } catch (error:any) {
    sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "unblock user failed",
      });
    }

  }
  public async blockUser(req:Request,res:Response){
    try {

      const {id}=req.query
      const data=await SuperAdminService.BlockUserById(id as string)
      console.log(data)
        sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "blocked successful",
        data,
      });
    } catch (error:any) {
    sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "blocked failed",
      });
    }

  }
  public async updateUser(req:Request,res:Response){
    try {
       const profileFilename = req.file?.filename;
      const {fullName,email,role,projects,id}=req.body
      const data=await SuperAdminService.updateOneUser({fullName,email,role,projects,id})
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "User edited successfully",
        data,
      });
    } catch (error:any) {
       sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "User edit failed",
      });
    
  }
}
}
