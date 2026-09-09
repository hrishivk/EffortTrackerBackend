import { Sequelize, Model, DataTypes } from "sequelize";
import { RoomMemberStatus } from "../../types/workspace.types";

export class RoomMember extends Model {
  public id!: string;
  public room_id!: string;
  // Denormalised. It was added to make "one room per workspace per user" a DB
  // constraint; that rule is gone (016), but the column stays because the
  // approval queue reads pending rows by workspace and every non-SP read
  // resolves visibility through (workspace_id, user_id, status).
  public workspace_id!: string;
  public user_id!: string;
  // `active` is the only status that counts as membership anywhere — a pending
  // row must never surface as a member or in an assignee list.
  //
  // Defaults to active because a manager placing someone in a room IS the
  // approval; only the self-service join flow creates `pending`.
  public status!: RoomMemberStatus;
  public requested_at!: Date | null;
  public decided_by!: string | null;
  public decided_at!: Date | null;
  public created_at!: Date;
}

export const initRoomMemberModel = (sequelize: Sequelize) => {
  RoomMember.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "RMM_" + generateAlphaNumericValue(12),
      },
      room_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "rooms", key: "id" },
        onDelete: "CASCADE",
      },
      workspace_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "workspaces", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      status: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "active",
      },
      // Set only on a self-service request, so it stays null on the rows the
      // wizard and the board create.
      requested_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      decided_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      decided_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "room_members",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        // One row per person per room, whatever its status. A user re-asking
        // for a room they were rejected from flips that row back to pending
        // rather than inserting a second one.
        { unique: true, fields: ["room_id", "user_id"] },
        // NOT unique, on purpose and permanently. A user may be in several
        // rooms of one workspace: the wizard's drag ADDS rather than moves. A
        // unique pair here would block the second room outright. Plain lookup
        // index only — see migration 016.
        { fields: ["workspace_id", "user_id"] },
        // The manager's approval queue.
        { fields: ["workspace_id", "status"] },
        { fields: ["user_id"] },
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

export default initRoomMemberModel;
