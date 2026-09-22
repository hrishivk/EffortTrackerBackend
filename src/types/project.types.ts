import { Optional } from "sequelize";

export interface ProjectAttributes {
  id: string;
  domain_id: string;
  created_by?: string | null;
  name: string;
  description: string;
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
  client_department?: string;
  start_date?: string;
  end_date?: string;
  status?: "active" | "on_hold" | "paused" | "completed";
  created_by?: string;
}

// PATCH /role-sp/project?id= — a PARTIAL update, unlike ProjectUpsertDTO above.
//
// Every field optional, and `undefined` means "leave unchanged", so the edit
// modal can send only what the user touched. That is the difference that
// matters: the upsert DTO requires `name` and `domain_id` on every call, so a
// client sending one changed field through it would blank nothing but would be
// rejected for the two it did not send.
//
// `null` is accepted where the column is nullable and means "clear it".
export interface ProjectPatchDTO {
  name?: string;
  description?: string | null;
  domain_id?: string;
  client_department?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
}
