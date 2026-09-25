import { Sequelize, Model, DataTypes } from "sequelize";

// One recorded push of a task's deadline. See 022_create_task_extensions.sql
// for why this is a table and not a JSONB column on tasks like comments.
export class TaskExtension extends Model {
  public id!: string;
  public task_id!: string;
  // Null when the task had no due date before this push — a first date is
  // still an extension, it just moved from nothing.
  public previous_due_date!: string | null;
  public new_due_date!: string;
  public reason!: string;
  public extended_by!: string | null;
  public created_at!: Date;
}

export const initTaskExtensionModel = (sequelize: Sequelize) => {
  TaskExtension.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "TE_" + generateAlphaNumericValue(12),
      },
      task_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "tasks", key: "id" },
        onDelete: "CASCADE",
      },
      // DATEONLY, matching tasks.start_date / due_date: a deadline is a day,
      // and a timestamp here would drift by one across timezones.
      previous_due_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      new_due_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // No `references`: the row outlives the user. See the migration.
      extended_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "task_extensions",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [{ fields: ["task_id", "created_at"] }, { fields: ["extended_by"] }],
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

export default initTaskExtensionModel;
