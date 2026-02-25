export enum Role {
  SuperAdmin = 'SP',
  Admin = 'AM',
  Manager = 'MG',
  User = 'USER',
  Devloper = 'DEVLOPER',
}

export type RoleType = `${Role}`;