import { Sequelize, Model, DataTypes } from "sequelize";


export class WorkspaceUnlock extends Model {
  public id!: string;
  public session_id!: string;
  public user_id!: string;
  public workspace_id!: string;
  public created_at!: Date;
}

export const initWorkspaceUnlockModel = (sequelize: Sequelize) => {
  WorkspaceUnlock.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "WU_" + generateAlphaNumericValue(12),
      },
      session_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      workspace_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "workspaces", key: "id" },
        onDelete: "CASCADE",
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "workspace_unlocks",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { unique: true, fields: ["session_id", "workspace_id"] },
        { fields: ["session_id", "user_id"] },
        { fields: ["created_at"] },
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

export default initWorkspaceUnlockModel;
