import { Optional } from "sequelize";

export interface ProjectAttributes {
  id: string;
  domain_id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}
export type PublicUser = {
  role: string;
  email: string;
  fullName: string;
  image: string;
};
export interface AddUserDTO {
  fullName: string;
  email: string;
  password: string;
  role: string;
  manager_id?: number;
  profileFilename?: string; 
}
export type ProjectInput = Optional<
  ProjectAttributes,
  | "id"
  | "domain_id"
  | "name"
  | "description"
  | "createdAt"
  | "updatedAt"
>;

export type ProjectOutput = Required<ProjectAttributes>;
