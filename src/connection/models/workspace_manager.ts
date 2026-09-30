import { Sequelize, Model, DataTypes } from "sequelize";

// An AM assigned to manage a workspace they did not create. Composite primary
// key, so assigning the same person twice is a no-op rather than a second row.
export class WorkspaceManager extends Model {
  public workspace_id!: string;
  public user_id!: string;
  public assigned_by!: string | null;
  public created_at!: Date;
}

export const initWorkspaceManagerModel = (sequelize: Sequelize) => {
  WorkspaceManager.init(
    {
      workspace_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
        references: { model: "workspaces", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      assigned_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "workspace_managers",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [{ fields: ["user_id"] }],
    }
  );
};

export default initWorkspaceManagerModel;
