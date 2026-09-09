import { Sequelize, Model, DataTypes } from "sequelize";

export class Room extends Model {
  public id!: string;
  public workspace_id!: string;
  // Denormalised from the workspace today. Kept so one workspace can span
  // several projects later without a migration.
  public project_id!: string | null;
  public name!: string;
  // The line under the room name on the card: "Handles user interface and
  // client-side development."
  public description!: string | null;
  public position!: number;
  public created_at!: Date;
  public updated_at!: Date;
}

export const initRoomModel = (sequelize: Sequelize) => {
  Room.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "RM_" + generateAlphaNumericValue(12),
      },
      workspace_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "workspaces", key: "id" },
        onDelete: "CASCADE",
      },
      project_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "projects", key: "id" },
        onDelete: "SET NULL",
      },
      name: {
        type: DataTypes.STRING(40),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING(200),
        allowNull: true,
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      tableName: "rooms",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { fields: ["workspace_id", "position"] },
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

export default initRoomModel;
