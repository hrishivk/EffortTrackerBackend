export enum Role {
  SuperAdmin = 'SP',
  Admin = 'AM',
  Manager = 'AM',
  User = 'USER',
  Devloper = 'DEVLOPER',
}

export type RoleType =
  | Role.SuperAdmin
  | Role.Admin
  | Role.Manager
  | Role.User
  | Role.Devloper;