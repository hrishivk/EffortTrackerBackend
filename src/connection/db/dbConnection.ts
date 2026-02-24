import { Sequelize } from "sequelize";
import { envConfig } from "../../config/env.config";
import { Associations } from "./association";

export class Database {
  private static instance: Sequelize;

  public static async init(): Promise<void> {
    if (Database.instance) return;

    const dialectOptions =
      envConfig.DB_SSL === "true"
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : undefined;

    const sequelize = new Sequelize({
      schema: envConfig.DB_SCHEMA,
      database: envConfig.DB_NAME,
      username: envConfig.DB_USERNAME,
      password: envConfig.DB_PASSWORD,
      host: envConfig.DB_HOST,
      port: +envConfig.DB_PORT! || 5432,
      dialect: "postgres",
      dialectOptions,
    });

    await sequelize.authenticate();
    console.log("Database connected successfully");

    Associations.initModels(sequelize);
    Associations.initialize();
    await sequelize.sync({ alter: true });

    Database.instance = sequelize;
  }

  public static getSequelize(): Sequelize {
    if (!Database.instance) {
      throw new Error("Database not initialized. Call Database.init() first.");
    }
    return Database.instance;
  }
}