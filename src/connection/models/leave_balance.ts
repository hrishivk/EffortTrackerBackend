import { Sequelize, Model, DataTypes } from "sequelize";

export class LeaveBalance extends Model {
  public id!: string;
  public user_id!: string;
  public leave_type!: string;
  public total!: number;
  public used!: number;
  public remaining!: number;
  public year!: number;
}

export const initLeaveBalanceModel = (sequelize: Sequelize) => {
  LeaveBalance.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "LB_" + generateAlphaNumericValue(12),
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      leave_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      total: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      used: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      remaining: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      year: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "leave_balance",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "leave_type", "year"],
        },
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

export default initLeaveBalanceModel;
