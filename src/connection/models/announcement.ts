import { Sequelize, Model, DataTypes } from "sequelize";

// A release SP announced from the What's New page. See migration 025.
export class Announcement extends Model {
  public id!: string;
  public version!: string;
  public title!: string;
  public message!: string | null;
  public created_by!: string | null;
  public created_at!: Date;
}

export const initAnnouncementModel = (sequelize: Sequelize) => {
  Announcement.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "AN_" + generateAlphaNumericValue(12),
      },
      // Not unique: SP can re-send a release at any time, and each send is its
      // own row (migration 026).
      version: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true,
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
    },
    {
      tableName: "announcements",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [{ fields: ["created_at"] }, { fields: ["version", "created_at"] }],
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

export default initAnnouncementModel;
