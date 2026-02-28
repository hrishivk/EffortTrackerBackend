import { Request, Response, NextFunction } from "express";
import { userService } from "../service/user.service";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import { superAdminService } from "../service/super-admin.service";

const SuperAdminService = new superAdminService();
export class SuperAdminController {
    public async user(req: Request, res: Response) {
    try {
      const {
        fullName, email, password, role,
        jobTitle, employeeId, contactNumber, dateOfBirth,
        bloodGroup, department, workSchedule, joiningDate,
        projects, sendWelcomeEmail, requirePasswordChange,
      } = req.body;

      // AM creating user → auto-set manager_id from JWT
      const callerRole = req.user?.role;
      const manager_id = callerRole === "AM" ? req.user?.id : req.body.manager_id;

      const data = await SuperAdminService.addUser({
        fullName,
        email,
        password,
        role,
        manager_id,
        job_title: jobTitle,
        employee_id: employeeId,
        contact_number: contactNumber,
        date_of_birth: dateOfBirth,
        blood_group: bloodGroup,
        department,
        work_schedule: workSchedule,
        joining_date: joiningDate,
        require_password_change: requirePasswordChange,
        projects,
        sendWelcomeEmail,
      });
      sendResponse(res, HTTP_statusCode.CREATED, {
        success: true,
        message: "User created successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Email already exists.": HTTP_statusCode.Conflict,
        "Employee ID already exists.": HTTP_statusCode.Conflict,
        "Password is required.": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "User creation failed",
      });
    }
  }
  public async upsertDomain(req: Request, res: Response) {
    try {
      const { id, name, description } = req.body;
      const data = await SuperAdminService.upsertDomain({ id, name, description });
      sendResponse(res, id ? HTTP_statusCode.OK : HTTP_statusCode.CREATED, {
        success: true,
        message: id ? "Domain updated successfully" : "Domain created successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Domain not found": HTTP_statusCode.NotFound,
        "Domain with this name already exists": HTTP_statusCode.Conflict,
        "Domain name is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Domain operation failed",
      });
    }
  }

  public async deleteDomain(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const data = await SuperAdminService.deleteDomain(id as string);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Domain deleted successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Domain not found": HTTP_statusCode.NotFound,
        "Domain id is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Domain deletion failed",
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
  public async projectStats(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const data = await SuperAdminService.getProjectStats(userId, userRole);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Stats fetched successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Fetching stats failed",
      });
    }
  }

  public async fetchProject(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const search = req.query.search as string | undefined;
      const page = req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const result = await SuperAdminService.getAllProjects(userId, userRole, search, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data: result.data,
        totalPages: result.totalPages,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }
  }

  public async fetchDomainProject(req:Request,res:Response){
    try {
      const data=await SuperAdminService.getAllDomainProject()
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Listed Sucessfully",
        data,
      });
    } catch (error:any) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }
  }
  public async upsertProject(req: Request, res: Response) {
    try {
      const { id, name, description, domain_id, client_department, start_date, end_date, status } = req.body;
      const created_by = req.user?.id;
      const data = await SuperAdminService.upsertProject({
        id, name, description, domain_id, client_department, start_date, end_date, status, created_by,
      });
      sendResponse(res, id ? HTTP_statusCode.OK : HTTP_statusCode.CREATED, {
        success: true,
        message: id ? "Project updated successfully" : "Project created successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "Domain not found": HTTP_statusCode.NotFound,
        "Project with this name already exists": HTTP_statusCode.Conflict,
        "Project name is required": HTTP_statusCode.BadRequest,
        "Domain is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Project operation failed",
      });
    }
  }

  public async deleteProject(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const data = await SuperAdminService.deleteProject(id as string);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Project deleted successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "Project id is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Project deletion failed",
      });
    }
  }
  public async updateProjectStatus(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const { status } = req.body;
      const data = await SuperAdminService.updateProjectStatus(id as string, status);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Project status updated successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "Project id is required": HTTP_statusCode.BadRequest,
        "Status is required": HTTP_statusCode.BadRequest,
        "Invalid status. Must be: active, on_hold, paused, completed": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Status update failed",
      });
    }
  }

  public async fetchUsers(req:Request,res:Response){
    try {
      const { search, role, isBlocked, project_id, page, limit } = req.query;
      const userRole = req.user?.role;
      const userId = req.user?.id;

      const data = await SuperAdminService.getAllUsers({
        search: search as string,
        role: role as string,
        isBlocked: isBlocked as string,
        project_id: project_id as string,
        manager_id: userRole === "AM" ? userId : undefined,
        page: Math.max(parseInt(page as string) || 1, 1),
        limit: Math.min(Math.max(parseInt(limit as string) || 10, 1), 100),
      });

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
      console.log(error)
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
  public async updateUser(req: Request, res: Response) {
    try {
      const {
        id, fullName, email, role, manager_id,
        jobTitle, employeeId, contactNumber, dateOfBirth,
        bloodGroup, department, workSchedule, joiningDate,
        requirePasswordChange,
      } = req.body;

      const data = await SuperAdminService.updateOneUser({
        id, fullName, email, role, manager_id,
        job_title: jobTitle,
        employee_id: employeeId,
        contact_number: contactNumber,
        date_of_birth: dateOfBirth,
        blood_group: bloodGroup,
        department,
        work_schedule: workSchedule,
        joining_date: joiningDate,
        require_password_change: requirePasswordChange,
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "User edited successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "User edit failed",
      });
    }
  }

  public async assignMembers(req: Request, res: Response) {
    try {
      const { project_id, user_ids } = req.body;
      const callerRole = req.user?.role;
      const callerId = req.user?.id;

      // Auto-add AM to the project when they assign their team
      let finalUserIds = [...user_ids];
      if (callerRole === "AM" && callerId && !finalUserIds.includes(callerId)) {
        finalUserIds.push(callerId);
      }

      const data = await SuperAdminService.assignProjectMembers(project_id, finalUserIds);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Members assigned successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "Project id is required": HTTP_statusCode.BadRequest,
        "At least one user is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Member assignment failed",
      });
    }
  }

  public async removeMembers(req: Request, res: Response) {
    try {
      const { project_id, user_ids } = req.body;
      const data = await SuperAdminService.removeProjectMembers(project_id, user_ids);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Members removed successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "No members found to remove": HTTP_statusCode.NotFound,
        "Project id is required": HTTP_statusCode.BadRequest,
        "At least one user is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Member removal failed",
      });
    }
  }

  public async getMembers(req: Request, res: Response) {
    try {
      const { project_id } = req.query;
      const data = await SuperAdminService.getProjectMembers(project_id as string);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Members fetched successfully",
        data,
      });
    } catch (error: any) {
      const statusMap: Record<string, number> = {
        "Project not found": HTTP_statusCode.NotFound,
        "Project id is required": HTTP_statusCode.BadRequest,
      };
      sendResponse(res, statusMap[error.message] || HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Fetching members failed",
      });
    }
  }

}
