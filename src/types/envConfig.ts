export interface EnvConfig {
  port?: string;
  DB_HOST?: string;
  DB_SSL?: string;
  DB_PORT?: string;
  DB_USERNAME?: string;
  DB_PASSWORD?: string;
  DB_NAME?: string;
  DB_SCHEMA?: string;
  DB_LOGGING?: string;
  BASE_URL?: string;
  ACCESS_SECRET?: string;      
  REFRESH_SECRET?: string;      
  production?: string;
}