import { Sequelize, Model, DataTypes } from "sequelize";

export class ProjectMember extends Model {
  public id!: string;
  public project_id!: string;
  public user_id!: string;
  public role!: string;
  public created_at!: Date;
}

export const initProjectMemberModel = (sequelize: Sequelize) => {
  ProjectMember.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      project_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: "projects",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      role: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "project_members",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ["project_id", "user_id"],
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

export default initProjectMemberModel;
