import express, { Application } from "express";
import http from "http";
import { Database } from "./connection/db/dbConnection";

import { envConfig } from "./config/env.config";
import { configureExpress } from "./config/express.config";
import { registerRoutes } from "./routes/index.route";

async function bootstrap(): Promise<void> {
  await Database.init();

  const app: Application = express();
  configureExpress(app);
  registerRoutes(app);

  const server = http.createServer(app);
  server.listen(envConfig.port, () => {
  console.log(`Server is running on port ${envConfig.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});