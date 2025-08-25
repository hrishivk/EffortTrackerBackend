
import { Domain } from '../connection/models/domain';
import { Project } from '../connection/models/project';
import { User } from '../connection/models/user';

export class adminManagerRepository {
  public async listAllusers(id: string) {
    try {
       return  await User.findAll({order:[["createdAt","DESC"]],where: {manager_id: id,} , include: [
           {
             model: Project,
             include: [{ model: Domain }], 
           },
         ],}); 
    } catch (error) {
      throw error
    }
    
  }
}
