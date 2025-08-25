import dotenv from "dotenv"
import { EnvConfig } from "../types/envConfig"
dotenv.config()

export const envConfig:EnvConfig = {
    port:process.env.PORT ,
    DB_HOST: process.env.DB_HOST,
    DB_SSL: process.env.DB_SSL,
    DB_PORT: process.env.DB_PORT,
    DB_USERNAME: process.env.DB_USERNAME,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_NAME: process.env.DB_NAME,
    DB_SCHEMA: process.env.DB_SCHEMA,
    DB_LOGGING: process.env.DB_LOGGING  ,
    BASE_URL:process.env.BASE_URL,
    ACCESS_SECRET:process.env.SECRET ,
    REFRESH_SECRET:process.env.REFRESH_SECRET ,
    production:process.env.PRODUCTION
}