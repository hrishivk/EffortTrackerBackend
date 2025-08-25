import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { envConfig } from "../config/env.config";

export class credentialHashing {
  public async hashPassword(password: string): Promise<string> {
    try {
      const saltRounds = 10;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      console.error("Password hashing failed:", error);
      throw error;
    }
  }
 public async newHashtoken(email: string,role: string): Promise<{ accessToken: string}> {
    try {
      const payload = { email, role };
        const secret = envConfig.ACCESS_SECRET
        ? envConfig.ACCESS_SECRET
        : (() => {
            throw new Error("Secret key not found");
          })();
      const accessToken = jwt.sign(payload, envConfig.ACCESS_SECRET, { expiresIn: "5m" });


      return { accessToken };
    } catch (error) {
      console.error("Token generation failed:", error);
      throw error;
    }
  }
  public async hashtoken(
    email: string,
    role: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = { email, role };
      const secret = envConfig.ACCESS_SECRET
        ? envConfig.ACCESS_SECRET
        : (() => {
            throw new Error("Secret key not found");
          })();

      const refreshsecret = envConfig.REFRESH_SECRET
        ? envConfig.REFRESH_SECRET
        : (() => {
            throw new Error("refreshTokenSecret  key not found");
          })();
      const accessToken = jwt.sign(payload, envConfig.ACCESS_SECRET, {
        expiresIn: "5m",
      });
      const refreshToken = jwt.sign(payload, envConfig.REFRESH_SECRET, {
        expiresIn: "2d",
      });
      return { accessToken, refreshToken };
    } catch (error) {
      console.error("Token generation or hashing failed:", error);
      throw error;
    }
  }
}
