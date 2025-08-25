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
  public image!: string;
  public lastSeenAt?: Date | null | string;
  public project_id!: string;
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
      image: {
        type: DataTypes.STRING(300),
      },
      lastSeenAt: {
        type: DataTypes.STRING(300),
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
      },
      project_id: {
        type: DataTypes.STRING(20),
        references: {
          model: "projects", 
          key: "id",
        },
      },
      updatedAt: {
        type: DataTypes.DATE,
      },
    },
    {
      tableName: "users",
      underscored: true,
      sequelize,
      schema: "public",
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
