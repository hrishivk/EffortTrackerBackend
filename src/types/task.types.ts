import { Task } from "../connection/models/tasks";

export interface TaskStatusUpdate {
  id: string;
  status: string;
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
