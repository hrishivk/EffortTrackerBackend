import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";

export class expressConfig {
  static configure(app: Application): void {
    const corsConfig = {
      origin: "https://effort-tracker-frontend-ztwy.vercel.app", 
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], 
      allowedHeaders: ["Content-Type", "Authorization"], 
    };

    app.use(cors(corsConfig));

    // Handle preflight requests
    app.options("*", cors(corsConfig));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(morgan("dev"));
    app.use(cookieParser());
    app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
  }
}
