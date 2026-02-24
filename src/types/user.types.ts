import { Optional } from "sequelize";

export interface userAttributes {
  id: string;
  email: string;
  password: string;
  fullName: string;
  role: string;
  isBlocked: boolean;
  manager_id: string;
  job_title?: string | null;
  employee_id?: string | null;
  contact_number?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  department?: string | null;
  work_schedule?: string | null;
  joining_date?: string | null;
  project_category?: string | null;
  require_password_change?: boolean;
  lastSeenAt?: Date | null | string;
  createdAt: Date;
  updatedAt: Date;
}
export interface PublicUser {
  id: string;
  role: string;
  email: string;
  fullName: string;
}
export interface AddTask {
  dailyTaskLog?: any;
  created_by?: string;
  assigned_to?: string;
  project?: string;
  project_id?: string;
  description: string;
  priority: string;
  status?: string;
  end_time?: string;
  created_at?: Date;
  updated_at?: Date;
  daily_log_id?: number;
}
export interface tokenResponse {
  accessToken: string;
  refreshToken: string;
}
export interface LoginResponse {
  user: PublicUser;
  token: tokenResponse;
}
export interface AddUserDTO {
  id?: string;
  fullName: string;
  email: string;
  password?: string;
  role: string;
  manager_id?: string;
  job_title?: string;
  employee_id?: string;
  contact_number?: string;
  date_of_birth?: string;
  blood_group?: string;
  department?: string;
  work_schedule?: string;
  joining_date?: string;
  project_category?: string;
  require_password_change?: boolean;
  projects?: string;
  sendWelcomeEmail?: boolean;
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
  | "job_title"
  | "employee_id"
  | "contact_number"
  | "date_of_birth"
  | "blood_group"
  | "department"
  | "work_schedule"
  | "joining_date"
  | "project_category"
  | "require_password_change"
  | "lastSeenAt"
  | "createdAt"
  | "updatedAt"
>;

export type userOutput = Required<userAttributes>;
