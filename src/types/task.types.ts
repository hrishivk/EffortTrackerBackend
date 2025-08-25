import { Task } from "../connection/models/tasks";

export interface TaskStatusUpdate {
  id: number;
  status: string;
  DailyTaskLog?:any
}
export interface TaskWithDailyLog extends Task {
  DailyTaskLog?: {
    locked: boolean;
  };
}
export interface TaskData{
  date:string |undefined;
  id:string |undefined
}
export type  TaskStatus = 'yet to start' | 'In Progress' | 'Completed';