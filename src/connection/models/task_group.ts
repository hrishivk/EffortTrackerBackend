import { Sequelize, Model, DataTypes, Op } from "sequelize";

export class TaskGroup extends Model {
  public id!: string;
  public user_id!: string;
  public name!: string;
  public color!: string | null;
  public position!: number;
  // Shared lanes are visible on every board; the rest belong to their owner.
  public is_shared!: boolean;
  // Hidden from its owner's board. Display only: tasks in it are untouched.
  public hidden!: boolean;
  // The board this lane is drawn on: a room, or NULL for the owner's own
  // board outside any room.
  public room_id!: string | null;
  // The status a card takes when moved into this lane; null = it keeps its own.
  public marks_status!: string | null;
  public created_at!: Date;
  public updated_at!: Date;
}

export const initTaskGroupModel = (sequelize: Sequelize) => {
  TaskGroup.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "TG_" + generateAlphaNumericValue(12),
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_shared: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      hidden: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      room_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "rooms", key: "id" },
        onDelete: "CASCADE",
      },
      marks_status: {
        type: DataTypes.STRING(20),
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
      tableName: "task_groups",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["room_id"], name: "idx_task_groups_room_id" },
        // Unique per user per board — see migration 027 for why it is two
        // partial indexes. Named to match it, so sync() finds them existing.
        {
          unique: true,
          fields: ["user_id", "name"],
          where: { room_id: null },
          name: "uq_task_groups_own_board_name",
        },
        {
          unique: true,
          fields: ["user_id", "room_id", "name"],
          where: { room_id: { [Op.ne]: null } },
          name: "uq_task_groups_room_board_name",
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

export default initTaskGroupModel;
