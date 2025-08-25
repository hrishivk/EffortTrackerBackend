import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { envConfig } from "../config/env.config";
import HTTP_statusCode from "../Enums/statuCode";
import { Role } from "../Enums/Role";
import { credentialHashing } from "../credential/hash";
const JWT_SECRET = envConfig.ACCESS_SECRET as string;
const JWT_REfresh_SECRET = envConfig.REFRESH_SECRET as string;

const CredentialHashing = new credentialHashing();
declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload & { email: string; role: Role };
  }
}
const authorize = (allowedRoles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction):Promise<any> => {
    let token = req.cookies?.rhythmrx_auth;
    try {
      if (!token) {
        const refreshToken = req.cookies.rhythmrx_refresh_auth;
        if (!refreshToken) {
           res.status(HTTP_statusCode.unAuthorized).json({
            error: "Authentication refresh token missing",
          });
        }
        const refreshDecoded = jwt.verify( refreshToken,JWT_REfresh_SECRET) as JwtPayload;
        const user = {
          email: refreshDecoded.email,
          role: refreshDecoded.role,
        };
        const newAccessToken = await CredentialHashing.newHashtoken(
          user.email,
          user.role
        );
        res.cookie("rhythmrx_auth", newAccessToken.accessToken, {
          httpOnly: true,
          secure: false,
          maxAge: 5 * 60 * 1000,
          sameSite: "strict",
          path: "/",
        });
        token = newAccessToken.accessToken;
      }
      
      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;


      const role = decoded.role as Role;
      if (!allowedRoles.includes(role)) {
        return res.status(HTTP_statusCode.NoAccess).json({
          error: "Access denied: insufficient permissions",
        });
      }
      req.user = {
        email: decoded.email,
        role: decoded.role,
        iat: decoded.iat,
        exp: decoded.exp,
      };

      next();
    } catch (err: any) {
      console.error("JWT verification failed:", err.message);
      return res.status(HTTP_statusCode.unAuthorized).json({
        error: "Invalid or expired authentication token",
      });
    }
  };
};

export const roleGuards = {
  SuperAdmin: authorize([Role.SuperAdmin]),
  Admin: authorize([Role.Admin]),
  Manager: authorize([Role.Manager]),
  User: authorize([Role.User]),
  AdminOrManager: authorize([Role.Admin, Role.Manager]),
  AdminOrSuperAdmin: authorize([Role.Admin, Role.SuperAdmin]),
  allAcess:authorize([Role.User,Role.SuperAdmin,Role.Manager,Role.User,Role.Devloper]),
  AnyAuthenticated: authorize(Object.values(Role)),
};

export default authorize;
