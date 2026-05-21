import { Sequelize, Model, DataTypes } from "sequelize";

export class Leave extends Model {
  public id!: string;
  public user_id!: string;
  public manager_id!: string | null;
  public admin_id!: string | null;
  public leave_type!: string;
  public session!: string;
  public start_date!: string;
  public end_date!: string;
  public total_days!: number;
  public reason!: string;
  public contact!: string | null;
  public status!: string;
  public manager_remarks!: string | null;
  public admin_remarks!: string | null;
  public applied_at!: Date;
  public manager_action_at!: Date | null;
  public admin_action_at!: Date | null;
  public created_at!: Date;
  public updated_at!: Date;
}

export const initLeaveModel = (sequelize: Sequelize) => {
  Leave.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "LV_" + generateAlphaNumericValue(12),
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      manager_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      admin_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      leave_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      session: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      total_days: {
        type: DataTypes.DECIMAL(4, 1),
        defaultValue: 1,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      contact: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: "pending",
      },
      manager_remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      admin_remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      applied_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      manager_action_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      admin_action_at: {
        type: DataTypes.DATE,
        allowNull: true,
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
      tableName: "leaves",
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

export default initLeaveModel;
