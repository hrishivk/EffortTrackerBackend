import { Sequelize, Model, DataTypes } from "sequelize";
import { userAttributes, userInput } from "../../types/user.types";

export class User
  extends Model<userAttributes, userInput>
  implements userAttributes
{
  public id!: string;
  public email!: string;
  public password!: string;
  public fullName!: string;
  public role!: string;
  public isBlocked!: boolean;
  public manager_id!: string;
  public job_title!: string | null;
  public employee_id!: string | null;
  public contact_number!: string | null;
  public date_of_birth!: string | null;
  public blood_group!: string | null;
  public department!: string | null;
  public work_schedule!: string | null;
  public joining_date!: string | null;
  public project_category!: string | null;
  public require_password_change!: boolean;
  public lastSeenAt?: Date | null | string;
  public createdAt!: Date;
  public updatedAt!: Date;
}

export const initUserModel = (sequelize: Sequelize) => {
  User.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      email: {
        type: DataTypes.STRING(100),
      },
      password: {
        type: DataTypes.STRING(200),
      },
      fullName: {
        type: DataTypes.STRING(100),
      },
      role: {
        type: DataTypes.STRING(50),
      },
      isBlocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      manager_id: {
        type: DataTypes.STRING(50),
      },
      job_title: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      employee_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      contact_number: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      date_of_birth: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      blood_group: {
        type: DataTypes.STRING(10),
        allowNull: true,
      },
      department: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      work_schedule: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      joining_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      project_category: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      require_password_change: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      lastSeenAt: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
      },
      updatedAt: {
        type: DataTypes.DATE,
      },
    },
    {
      tableName: "users",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
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

export default initUserModel;
