import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";

export class expressConfig {
  static configure(app: Application): void {
    const FRONTEND = "https://effort-tracker-frontend-ztwy.vercel.app";

    const corsConfig: cors.CorsOptions = {
      origin: FRONTEND,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    };

    // ✅ must be before routes
    app.use(cors(corsConfig));

    // ✅ explicitly handle OPTIONS preflights
    app.options("/*", cors(corsConfig));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(morgan("dev"));
    app.use(cookieParser());
    app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));

    // If using cookies/sessions on Vercel/Netlify/Heroku:
    // app.set("trust proxy", 1);
  }
}
