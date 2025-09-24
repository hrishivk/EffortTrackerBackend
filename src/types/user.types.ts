import { Optional } from "sequelize";

export interface userAttributes {
  id: string;
  email: string;
  password: string;
  fullName: string;
  role: string;
  isBlocked: boolean;
  manager_id: string;
  lastSeenAt?: Date | null |string;
  project_id: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface PublicUser {
  id: string;
  role: string;
  email: string;
  fullName: string;
  projectName:any;
}
export interface AddTask{
  dailyTaskLog?:any;
  userId:string;
  project:string;
  description:string;
  priority:string;
  status?:string;
  created_at?:Date;
  updated_at?:Date;
   daily_log_id?:number
}
export interface tokenResponse{
    accessToken: string;        
    refreshToken: string; 
}
export interface LoginResponse {
  user: PublicUser;
  token: tokenResponse
}
export interface AddUserDTO {
  id?:string;
  fullName: string;
  email: string;
  password?: string;
  role: string;
  manager_id?: string;
  image?:string;
  profileFilename?: string; 
  projects:string
}
export type userInput = Optional<
  userAttributes,
  | "id"
  | "email"
  | "password"
  | "fullName"
  | "manager_id"
  | "role"
  | "isBlocked"
  | "lastSeenAt"
  | "project_id"
  | "createdAt"
  | "updatedAt"
>;

export type userOutput = Required<userAttributes>;
