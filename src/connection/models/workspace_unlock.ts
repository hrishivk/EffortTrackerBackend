import { Sequelize, Model, DataTypes } from "sequelize";

// "This login session typed the correct key for this workspace."
//
// Deliberately NOT a room_members row. The two facts have different lifetimes
// and grant different things:
//
//   room_members  a manager's decision. Survives logout. Grants ROOMS.
//   this          the caller typed the key. Dies with the session. Grants
//                 sight of the workspace shell, and nothing else.
//
// Keeping them apart is what makes the key get asked for again on the next
// login, and what stops a typed key from quietly appearing in a room's member
// list.
export class WorkspaceUnlock extends Model {
  public id!: string;
  // The `sid` claim from the caller's JWT — see newSessionId in credential/hash.
  // Not a FK: auth is stateless and there is no sessions table.
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
        // Re-entering the key is a no-op, not a second row.
        { unique: true, fields: ["session_id", "workspace_id"] },
        // The read path. user_id is in the key so a sid alone is not enough.
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
