import { adminManagerRepository } from "../repositories/admin-manager.repository";
import { superAdminRepository } from "../repositories/super-admin.repository";

const AdminManagerRepository = new adminManagerRepository();
export class adminMangerService {
  public async getAllUsers(id: string) {
    try {
      return await AdminManagerRepository.listAllusers(id);
    } catch (error) {
      throw error;
    }
  }
  public async addNewRoles(name: string, staus: boolean, isBlocked: boolean) {
    try {
    //   return await AdminManagerRepository.addRoles(name, staus, isBlocked);
    } catch (error: any) {
      throw error;
    }
  }
}
