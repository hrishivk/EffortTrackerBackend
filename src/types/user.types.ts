import { Optional } from "sequelize";

export interface userAttributes {
  id: string;
  email: string;
  password: string;
  fullName: string;
  role: string;
  isBlocked: boolean;
  manager_id: string;
  is_shared: boolean;
  job_title?: string | null;
  employee_id?: string | null;
  contact_number?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  department?: string | null;
  work_schedule?: string | null;
  joining_date?: string | null;
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
  start_date?: string;
  group_id?: string | null;
  // Set when the task is created from a room board. Lets the room page ask for
  // ITS tasks instead of deriving them from "tasks on this project assigned to
  // somebody in this room" — a derivation that double-counts anyone sitting in
  // two rooms of one project.
  room_id?: string | null;
  start_time?: string;
  parent_id?: string | null;
  tags?: unknown;
  subtasks?: SubTaskInput[];
  due_date?: string;
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
  manager_id?: string | null;
  is_shared?: boolean;
  // null clears the column; undefined leaves it untouched on edit
  job_title?: string | null;
  employee_id?: string | null;
  contact_number?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  department?: string | null;
  work_schedule?: string | null;
  joining_date?: string | null;
  require_password_change?: boolean;
  projects?: string;
  // Domains a shared user (is_shared) is linked to. Accepts an array or a
  // comma-separated string; the managers of these domains get to see the user.
  domain_ids?: string | string[];
  sendWelcomeEmail?: boolean;
}
// PATCH /role-sp/edit-user. Every field except `id` is optional and partial
// update semantics apply strictly:
//   undefined -> the caller did not send the key, leave the column unchanged
//   null      -> the caller sent "", clear the column
// The edit modal sends every profile field unconditionally, so an untouched
// input arrives as "" and must be able to blank a wrong value. Identity fields
// (fullName, email, role) are the exception: "" is rejected, not applied.
export interface EditUserDTO {
  id?: string;
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  manager_id?: string | null;
  is_shared?: boolean;
  job_title?: string | null;
  employee_id?: string | null;
  contact_number?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  department?: string | null;
  work_schedule?: string | null;
  joining_date?: string | null;
  require_password_change?: boolean;
  // Full replacement, not a delta: "1,4,9" makes the project set exactly
  // {1,4,9} and "" detaches from all. Absent leaves the set untouched.
  projects?: string;
  domain_ids?: string | string[];
}

export type userInput = Optional<
  userAttributes,
  | "id"
  | "email"
  | "password"
  | "fullName"
  | "manager_id"
  | "is_shared"
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
  | "require_password_change"
  | "lastSeenAt"
  | "createdAt"
  | "updatedAt"
>;

export type userOutput = Required<userAttributes>;

// One entry of the subtasks array on POST /task. "name" is the subtask's
// description; everything else mirrors the parent's fields.
export interface SubTaskInput {
  name?: string;
  description?: string;
  priority?: string;
  start_date?: string;
  due_date?: string;
  status?: string;
  tags?: unknown;
}
