import { Request, Response, NextFunction } from "express";
import { userService } from "../service/user.service";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import { envConfig } from "../config/env.config";

const UserService = new userService();

export class AuthController {
  public async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const data = await UserService.login(email, password);
      res.cookie("rhythmrx_auth", data.token?.accessToken, {
        httpOnly: true,
        secure: envConfig.Production=="Production",
        maxAge: 5 * 60 * 1000,
        sameSite: "strict",
        path: "/",
      });
      res.cookie("rhythmrx_refresh_auth", data.token?.refreshToken, {
        httpOnly: true,
        secure: envConfig.Production=="Production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "strict",
        path: "/",
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Login successful",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Login failed",
      });
    }
  }
  public async logOut(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const data = await UserService.logout(id as string);
      res.clearCookie("rhythmrx_auth", {
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        path: "/",
      });
      res.clearCookie("rhythmrx_refresh_auth", {
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        path: "/",
      });

      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Login successful",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Login failed",
      });
    }
  }

}
