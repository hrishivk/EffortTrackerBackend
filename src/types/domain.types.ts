import { Optional } from "sequelize";
export interface domainAttributes {
  id?: string;
  name: string;
  description: string;
}

export interface domainInput extends Partial<domainAttributes> {}

