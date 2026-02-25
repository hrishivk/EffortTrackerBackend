import express, { Application } from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import cookieParser from "cookie-parser";
import { envConfig } from "./env.config";

export function configureExpress(app: Application): void {
  app.use(
    cors({
      origin: ["https://www.effortracker.sbs", "https://effortracker.sbs", "http://localhost:5173"],
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan("dev"));
  app.use(cookieParser());
  app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));
}