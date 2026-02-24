import { Sequelize, Model, DataTypes } from "sequelize";
import { ProjectAttributes, ProjectInput } from "../../types/project.types";
import { Domain } from "./domain";

export class Project
  extends Model<ProjectAttributes, ProjectInput>
  implements ProjectAttributes
{
  public id!: string;
  public domain_id!: string;
  public created_by!: string | null;
  public name!: string;
  public description!: string;
  public project_category!: string | null;
  public client_department!: string | null;
  public start_date!: Date | null;
  public end_date!: Date | null;
  public status!: "active" | "on_hold" | "paused" | "completed";
  public progress!: number;
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
        references: {
          model: "domains",
          key: "id",
        },
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
      created_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      name: {
        type: DataTypes.STRING(200),
      },
      description: {
        type: DataTypes.STRING(1000),
      },
      project_category: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      client_department: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      start_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "on_hold", "paused", "completed"),
        defaultValue: "active",
      },
      progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 100,
        },
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
      schema: "tracker",
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
