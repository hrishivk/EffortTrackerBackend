import { Sequelize, Model, DataTypes } from "sequelize";
import { domainAttributes, domainInput } from "../../types/domain.types";

export class Domain
  extends Model<domainAttributes, domainInput>
  implements domainAttributes
{
  public id!: string;
  public name!: string;
  public description!: string;
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
    },
    {
      tableName: "domains",
      underscored: true,
      sequelize,
      schema: "public",
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
