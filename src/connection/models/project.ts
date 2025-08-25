import { Sequelize, Model, DataTypes } from "sequelize";
import { ProjectAttributes, ProjectInput } from "../../types/project.types";
import { Domain } from "./domain";

export class Project
  extends Model<ProjectAttributes, ProjectInput>
  implements ProjectAttributes
{
  public id!: string;
  public domain_id!: string;
  public name!: string;
  public description!: string;
  public createdAt!: Date;
  public updatedAt!: Date;
}

export const initProjectModel = (sequelize: Sequelize) => {
  Project.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      domain_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },

      name: {
        type: DataTypes.STRING(200),
      },
      description: {
        type: DataTypes.STRING(1000),
      },
      createdAt: {
        type: DataTypes.DATE,
      },
      updatedAt: {
        type: DataTypes.DATE,
      },
    },
    {
      tableName: "projects",
      underscored: true,
      sequelize,
      schema: "public",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      hooks: {
        beforeCreate: (project: Project) => {
          if (!project.id) {
            project.id = generateAlphaNumericValue(15);
          }
        },
      },
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

export default initProjectModel;
