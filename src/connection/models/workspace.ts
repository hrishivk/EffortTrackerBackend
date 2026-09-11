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
  // NULL means "not completed". Kept in step with `status` by the repository,
  // so these can never date a workspace that is back in progress.
  public completed_at!: Date | null;
  public completed_by!: string | null;
  // When the completion was last ANNOUNCED to somebody. Separate from
  // completed_at on purpose: completing tells nobody, and a workspace can be
  // completed and never announced. Re-stamped by a reminder.
  public announced_at!: Date | null;
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
      // Migration 019. Like every other column added to an existing table,
      // these have to be declared here or Sequelize never SELECTs or writes
      // them — sync() will not add them either.
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completed_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
        // A completion outlives the person who recorded it.
        onDelete: "SET NULL",
      },
      // Migration 020. NULL means nobody has been told yet, which is what the
      // Announce it strip tests on load.
      announced_at: {
        type: DataTypes.DATE,
        allowNull: true,
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
