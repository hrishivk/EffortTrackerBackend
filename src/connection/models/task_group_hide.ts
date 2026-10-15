import { Sequelize, Model, DataTypes, Op } from "sequelize";

// One lane hidden on one board: user_id's own board when room_id is NULL,
// otherwise their board in that room. Kept apart from task_groups because a
// shared lane is a single row drawn on every board — a flag on that row would
// hide it for everybody. Display only: no task is touched.
export class TaskGroupHide extends Model {
  public id!: string;
  public group_id!: string;
  public user_id!: string;
  public room_id!: string | null;
  public created_at!: Date;
}

export const initTaskGroupHideModel = (sequelize: Sequelize) => {
  TaskGroupHide.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => "TH_" + generateAlphaNumericValue(12),
      },
      group_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "task_groups", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: { model: "users", key: "id" },
        onDelete: "CASCADE",
      },
      room_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "rooms", key: "id" },
        onDelete: "CASCADE",
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "task_group_hides",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        // One row per lane per board — two partial indexes for the same
        // NULL-is-distinct reason as migration 027. Named to match 028.
        {
          unique: true,
          fields: ["group_id", "user_id"],
          where: { room_id: null },
          name: "uq_task_group_hides_own_board",
        },
        {
          unique: true,
          fields: ["group_id", "user_id", "room_id"],
          where: { room_id: { [Op.ne]: null } },
          name: "uq_task_group_hides_room_board",
        },
        { fields: ["user_id", "room_id"], name: "idx_task_group_hides_board" },
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

export default initTaskGroupHideModel;
