import { Sequelize, Model, DataTypes } from "sequelize";

export class DailyTaskLog extends Model {
  public id!: string;
  public user_id!: string; // FIX: should be string not number
  public date!: Date;
  public total_time!: string;
  public locked!: boolean;
  public locked_at!: Date | null;
  public created_at!: Date;
}

export const initDailyTaskLogModel = (sequelize: Sequelize) => {
  DailyTaskLog.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      user_id: {
        type: DataTypes.STRING(20), 
        allowNull: false,
        references: {
          model: "users", 
          key: "id",
        },
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      locked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      locked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "daily_task_logs",
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
