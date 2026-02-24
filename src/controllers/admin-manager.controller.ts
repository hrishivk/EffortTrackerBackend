import { Request, Response, NextFunction } from "express";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import { adminMangerService } from "../service/admin-manger.service";

const SuperAdminService = new adminMangerService();
export class managerController {
  public async listAllUsers(req: Request, res: Response):Promise<void> {
    try {
      const managerId = req.user?.id;
      if (!managerId) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const data = await SuperAdminService.getAllUsers(managerId);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }
  }
}
