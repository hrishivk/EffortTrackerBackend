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
    user?: JwtPayload & { id: string; email: string; role: Role };
  }
}
const authorize = (allowedRoles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction):Promise<any> => {
    let token = req.cookies?.rhythmrx_auth;
    try {
      if (!token) {
        const refreshToken = req.cookies?.rhythmrx_refresh_auth;
        if (!refreshToken) {
           return res.status(HTTP_statusCode.unAuthorized).json({
            error: "Authentication token missing",
          });
        }
        const refreshDecoded = jwt.verify( refreshToken,JWT_REfresh_SECRET) as JwtPayload;
        const user = {
          id: refreshDecoded.id,
          email: refreshDecoded.email,
          role: refreshDecoded.role,
        };
        const newTokens = await CredentialHashing.hashtoken(
          user.id,
          user.email,
          user.role
        );
        res.cookie("rhythmrx_auth", newTokens.accessToken, {
          httpOnly: true,
          secure: true,
          maxAge: 15 * 60 * 1000,
          sameSite: "none",
          path: "/",
        });
        res.cookie("rhythmrx_refresh_auth", newTokens.refreshToken, {
          httpOnly: true,
          secure: true,
          maxAge: 16 * 60 * 60 * 1000,
          sameSite: "none",
          path: "/",
        });
        token = newTokens.accessToken;
      }

      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

      const role = decoded.role as Role;
      if (!allowedRoles.includes(role)) {
        return res.status(HTTP_statusCode.NoAccess).json({
          error: "Access denied: insufficient permissions",
        });
      }
      req.user = {
        id: decoded.id,
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

type RoleGuards = Record<string, ReturnType<typeof authorize>>;

export const roleGuards = {
  SuperAdmin: authorize([Role.SuperAdmin]),
  Admin: authorize([Role.Admin]),
  Manager: authorize([Role.Manager]),
  User: authorize([Role.User]),
  Devloper: authorize([Role.Devloper]),
  AdminOrManager: authorize([Role.Admin, Role.Manager]),
  AdminOrSuperAdmin: authorize([Role.Admin, Role.SuperAdmin]),
  allAcess: authorize([Role.SuperAdmin, Role.Admin, Role.Manager, Role.User, Role.Devloper]),
  AnyAuthenticated: authorize(Object.values(Role)),
} as const satisfies RoleGuards;

export default authorize;
