import { Sequelize, Model, DataTypes } from "sequelize";

export class TaskGroup extends Model {
  public id!: string;
  public user_id!: string;
  public name!: string;
  public color!: string | null;
  public position!: number;
  // Shared lanes are visible on every board; the rest belong to their owner.
  public is_shared!: boolean;
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
        { unique: true, fields: ["user_id", "name"] },
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
