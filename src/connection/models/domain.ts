import { Sequelize, Model, DataTypes } from "sequelize";
import { domainAttributes, domainInput } from "../../types/domain.types";

export class Domain
  extends Model<domainAttributes, domainInput>
  implements domainAttributes
{
  public id!: string;
  public name!: string;
  public description!: string;
  public created_by!: string | null;
  public head_user_id!: string | null;
  public parent_id!: string | null;
  public sort_order!: number;
}

export const initDomain = (sequelize: Sequelize) => {
  Domain.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },

      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      created_by: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      // Shown on the department card. Must belong to the department — checked
      // in the service, not by a constraint. See migration 031.
      head_user_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "users", key: "id" },
        onDelete: "SET NULL",
      },
      // Sub-departments (Engineering -> Mobile). SET NULL, so deleting a
      // parent lifts its children to the top level instead of deleting them.
      parent_id: {
        type: DataTypes.STRING(20),
        allowNull: true,
        references: { model: "domains", key: "id" },
        onDelete: "SET NULL",
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "domains",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
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
export default initDomain;
