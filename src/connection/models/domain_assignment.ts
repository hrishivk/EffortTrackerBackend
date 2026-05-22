import { Sequelize, Model, DataTypes } from "sequelize";

export class DomainAssignment extends Model {
  public id!: string;
  public domain_id!: string;
  public user_id!: string;
  public created_at!: Date;
}

export const initDomainAssignmentModel = (sequelize: Sequelize) => {
  DomainAssignment.init(
    {
      id: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.STRING(20),
        defaultValue: () => generateAlphaNumericValue(15),
      },
      domain_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: "domains",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "domain_assignments",
      underscored: true,
      sequelize,
      schema: "tracker",
      timestamps: false,
      indexes: [
        {
          unique: true,
          fields: ["domain_id", "user_id"],
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

export default initDomainAssignmentModel;
