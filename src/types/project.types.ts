import { Optional } from "sequelize";

export interface ProjectAttributes {
  id: string;
  domain_id: string;
  created_by?: string | null;
  name: string;
  description: string;
  project_category?: string | null;
  client_department?: string | null;
  start_date?: Date | null;
  end_date?: Date | null;
  status: "active" | "on_hold" | "paused" | "completed";
  progress: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectInput = Optional<
  ProjectAttributes,
  | "id"
  | "domain_id"
  | "created_by"
  | "project_category"
  | "name"
  | "description"
  | "client_department"
  | "start_date"
  | "end_date"
  | "status"
  | "progress"
  | "createdAt"
  | "updatedAt"
>;

export type ProjectOutput = Required<ProjectAttributes>;

export interface ProjectUpsertDTO {
  id?: string;
  name: string;
  description?: string;
  domain_id: string;
  project_category?: string;
  client_department?: string;
  start_date?: string;
  end_date?: string;
  status?: "active" | "on_hold" | "paused" | "completed";
  created_by?: string;
}
