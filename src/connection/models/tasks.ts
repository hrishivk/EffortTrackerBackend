import { Sequelize, Model, DataTypes } from "sequelize";
// Type-only: task.types.ts imports Task back, so this must not become a
// runtime require or the two modules deadlock on load.
import type { TaskComment } from "../../types/task.types";

export class Task extends Model {
  public id!: string;
  public daily_log_id!: string | null;
  public project_id!: string;
  public group_id!: string | null;
  // The room this task belongs to, when it was created from a room board.
  // Nullable: most tasks have no room, and a task outlives one.
  public room_id!: string | null;
  // Set on a subtask; null on a top-level task.
  public parent_id!: string | null;
  // Order of this child inside its parent. Only meaningful with parent_id set.
  public position!: number;
  // Set on the PARENT: its children may only start in `position` order.
  public sequential!: boolean;
  // Comments on this row, newest last. A subtask is a row in this same table,
  // so this covers comments on a main task and on a single subtask alike.
  public comments!: TaskComment[];
  // Free-form labels. Applies to subtasks too — same table.
  public tags!: string[];
  public description!: string;
  public priority!: "Low" | "Medium" | "High";
  public start_time!: Date | null;
  public end_time!: Date | null;
  public total_time!: string | null;
  public total_seconds!: number;
  // The plan (manager-set), kept apart from start_time/end_time which record
  // what actually happened.
  public start_date!: string | null;
  public due_date!: string | null;
  // Free text since migration 009: holds either a status value or, when the
  // task is parked in a group, that group's name.
  public status!: string;
  public isLocked!: boolean;
  public created_at!: Date;
  public updated_at!: Date;
}

export const initTaskModel = (sequelize: Sequelize) => {
  Task.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      daily_log_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "daily_task_logs",
          key: "id",
        },
      },
      project_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "projects",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
      },
      parent_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "tasks",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      // NOT NULL with a 0 default rather than nullable: the sequential rule
      // compares positions, and a NULL would make a child look like it has no
      // predecessor and start out of turn instead of being ordered.
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Lives on the parent. Default false, so every task that already exists
      // keeps letting its children start in any order.
      sequential: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // JSONB, not JSON: every write goes through a pure-SQL jsonb expression
      // (`||` to append, jsonb_agg to edit or delete) so three people
      // commenting in the same moment cannot drop each other's comment. `json`
      // has no such operators and would force a read-modify-write in Node.
      //
      // Never assign to this attribute and save() the instance — that IS the
      // read-modify-write. Go through TaskCommentRepository.
      comments: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      group_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "task_groups",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      // SET NULL rather than CASCADE: deleting a room must not delete real
      // work, exactly as with group_id above. Like group_id, this has to be
      // declared here or Sequelize never SELECTs or writes the column.
      room_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "rooms",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      description: {
        type: DataTypes.TEXT,
      },
      priority: {
        type: DataTypes.ENUM("Low", "Medium", "High"),
      },
      start_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Existed in the table from the start but was never declared here, so
      // Sequelize never selected or wrote it — all 656 rows were NULL.
      total_time: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      total_seconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      due_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      status: {
        // VARCHAR(100) matches task_groups.name so any group name fits.
        type: DataTypes.STRING(100),
        defaultValue: "yet_to_start",
      },
      isLocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "tasks",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
    }
  );
};
function generateAlphaNumericValue(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}
