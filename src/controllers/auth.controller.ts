import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { userService } from "../service/user.service";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";

const UserService = new userService();
const readSid = (token?: string): string | undefined => {
  if (!token) return undefined;
  try {
    const decoded = jwt.decode(token) as { sid?: string } | null;
    return decoded?.sid;
  } catch {
    return undefined;
  }
};

export class AuthController {
  public async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const data = await UserService.login(email, password);
      res.cookie("rhythmrx_auth", data.token?.accessToken, {
        httpOnly: true,
        secure: true,
        maxAge: 15 * 60 * 1000,
        sameSite: "none",
        path: "/",
      });
      res.cookie("rhythmrx_refresh_auth", data.token?.refreshToken, {
        httpOnly: true,
        secure: true,
        maxAge: 16 * 60 * 60 * 1000,
        sameSite: "none",
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
      // The sid comes from the caller's own cookie, never the query string, so
      // one user cannot end another user's session unlocks.
      const sid = readSid(req.cookies?.rhythmrx_auth) ??
        readSid(req.cookies?.rhythmrx_refresh_auth);
      const data = await UserService.logout(id as string, sid);
      res.clearCookie("rhythmrx_auth", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      });
      res.clearCookie("rhythmrx_refresh_auth", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      });

      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Logout successful",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Logout failed",
      });
    }
  }
}
