import { Sequelize, Model, DataTypes } from "sequelize";
import {
  WorkspaceStatus,
  WorkspaceVisibility,
} from "../../types/workspace.types";

export class Workspace extends Model {
  public id!: string;
  public name!: string;
  // The "Workspace Key" (e.g. PD-2026). Optional, but unique when present.
  public code!: string | null;
  public status!: WorkspaceStatus;
  // `private` hides the workspace from everyone but SP, the creator and its
  // active room members. Defaults to private so a workspace is never published
  // by omission.
  public visibility!: WorkspaceVisibility;
  public description!: string | null;
  // The one project this workspace covers. Nullable so the workspace outlives a
  // deleted project instead of going with it.
  public project_id!: string | null;
  public created_by!: string | null;
  public created_at!: Date;
  public updated_at!: Date;
}

export const initWorkspaceModel = (sequelize: Sequelize) => {
  Workspace.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "WS_" + generateAlphaNumericValue(12),
      },
      name: {
        type: DataTypes.STRING(60),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      // VARCHAR + a DB CHECK rather than a PG enum: 009 had to drop the
      // task_status enum to widen it, and widening a CHECK is one ALTER.
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "planning",
      },
      // Same lowercase-token + DB CHECK treatment as status.
      visibility: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "private",
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      project_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "projects", key: "id" },
        onDelete: "SET NULL",
      },
      created_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "workspaces",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { fields: ["created_by"] },
        { fields: ["project_id"] },
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

export default initWorkspaceModel;
