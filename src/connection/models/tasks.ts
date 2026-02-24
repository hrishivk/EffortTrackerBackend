import { Sequelize, Model, DataTypes } from "sequelize";

export class Task extends Model {
  public id!: string;
  public daily_log_id!: string | null;
  public project_id!: string;
  public description!: string;
  public priority!: "Low" | "Medium" | "High";
  public start_time!: Date | null;
  public end_time!: Date | null;
  public total_time!: string | null;
  public status!: "yet_to_start" | "in_progress" | "completed" | "blocked";
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
        allowNull: false,
        references: {
          model: "projects",
          key: "id",
        },
        onDelete: "CASCADE",
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
      status: {
        type: DataTypes.ENUM("yet_to_start", "in_progress", "completed", "blocked"),
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
