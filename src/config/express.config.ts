// express.config.ts
import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";

export class expressConfig {
  static configure(app: Application): void {
    const FRONTEND = "https://effort-tracker-frontend-ztwy.vercel.app";

    const corsConfig: cors.CorsOptions = {
      origin: FRONTEND,                 // exact origin (required for credentials)
      credentials: true,                // allow cookies / auth headers
      methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
      allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
      exposedHeaders: [],               // add if you need to read any custom headers
      maxAge: 600,                      // cache the preflight (seconds)
    };

    // (1) MUST be before any routes or auth middleware
    app.use(cors(corsConfig));

    // (2) Explicitly handle all preflight requests (some setups need this)
    app.options("*", cors(corsConfig));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(morgan("dev"));
    app.use(cookieParser());
    app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));

    // If you ever set cookies, also ensure:
    // app.set("trust proxy", 1);
  }
}
