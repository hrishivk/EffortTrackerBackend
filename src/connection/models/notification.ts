import { Sequelize, Model, DataTypes } from "sequelize";

export class Notification extends Model {
  public id!: string;
  public user_id!: string;
  public type!: string;
  public title!: string;
  public message!: string;
  public reference_id!: string | null;
  public is_read!: boolean;
  public created_at!: Date;
}

export const initNotificationModel = (sequelize: Sequelize) => {
  Notification.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "NF_" + generateAlphaNumericValue(12),
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      type: {
        type: DataTypes.STRING(30),
        allowNull: false,
        // leave_applied, leave_approved, leave_rejected, leave_manager_approved, leave_manager_rejected, leave_cancelled
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      reference_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      is_read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "notifications",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { fields: ["user_id", "is_read"] },
      ],
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

export default initNotificationModel;
