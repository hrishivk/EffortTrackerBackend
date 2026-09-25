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
  // Append-only history. Typed loosely here because the column is written by
  // raw SQL, never through the model — see appendProjectActivity.
  activity?: any[];
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
  | "activity"
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
  // Not a column. Required when `end_date` moves LATER, and recorded as the
  // `reason` on the resulting `extended` activity entry — the same rule
  // POST /role-user/task/extend applies to tasks.
  extension_reason?: string;
}

// ── Project activity log ────────────────────────────────────────────────────

// One entry in projects.activity. See 023_project_activity.sql for why this is
// a JSONB column rather than a table like task_extensions.
export type ProjectActivityAction =
  | "created"
  | "extended"
  | "due_date_changed"
  | "status_changed"
  | "renamed"
  | "updated"
  | "member_added"
  | "member_removed";

export interface ProjectActivityEntry {
  id: string;
  action: ProjectActivityAction;
  // The column that moved. Null on `created`, where nothing moved, and the
  // user id on the two member actions.
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  // Required on `extended`, null everywhere else — same rule tasks follow.
  reason: string | null;
  // Snapshot of the actor's name at write time, so an entry still reads
  // correctly after the user is deleted. Live names win on read.
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}
