import { Sequelize, Model, DataTypes } from "sequelize";

export class Task extends Model {
  public id!: string;
  public daily_log_id!: number;
  public project!: string;
  public description!: string;
  public priority!: "Low" | "Medium" | "High";
  public start_time!: Date;
  public end_time!: Date;
  public total_time!: string;
  public status!: "yet to start" | "In Progress" | "Completed";
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
        references:{
          model:"daily_task_logs",
          key:"id"
        }
      },
      project: {
        type: DataTypes.STRING(255),
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
        type: DataTypes.ENUM("yet to start", "In Progress", "Completed"),
        allowNull: true,
        defaultValue: "yet to start",
      },
      isLocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
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
      schema: "public",
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
