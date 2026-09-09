import { Task } from "../connection/models/tasks";

export interface TaskStatusUpdate {
  id: string;
  // Both optional, and `undefined` means "leave unchanged". JSON has no
  // undefined, so an explicit `"group_id": null` from a status-lane drop is
  // distinguishable from a group drop that deliberately sends no status.
  status?: string;
  group_id?: string | null;
  DailyTaskLog?: any;
}
export interface TaskWithDailyLog extends Task {
  isLocked: boolean;
}
export interface TaskData {
  date: string | undefined;
  id: string | undefined;
}
export type TaskStatus = "yet_to_start" | "in_progress" | "completed" | "blocked";

export interface TaskGroupInput {
  user_id: string;
  name: string;
  color?: string | null;
  position?: number;
}

export interface TaskGroupPatch {
  name?: string;
  color?: string | null;
  position?: number;
}
