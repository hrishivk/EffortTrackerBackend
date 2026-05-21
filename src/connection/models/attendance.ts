import { Sequelize, Model, DataTypes } from "sequelize";

export class Attendance extends Model {
  public id!: string;
  public emp_id!: string;
  public date!: string;
  public entry_mode!: string;
  public date_time!: Date;
  public created_at!: Date;
}

export const initAttendanceModel = (sequelize: Sequelize) => {
  Attendance.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "AT_" + generateAlphaNumericValue(12),
      },
      emp_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      entry_mode: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      date_time: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "attendance",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { fields: ["emp_id", "date"] },
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

export default initAttendanceModel;
