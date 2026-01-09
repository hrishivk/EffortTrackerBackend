import { error } from "console";
import { superAdminRepository } from "../repositories/super-admin.repository";
import { AddUserDTO } from "../types/user.types";
import { UserRepository } from "../repositories/user.repository";

const SuperAdminRepository = new superAdminRepository();
const userRepository = new UserRepository();
export class superAdminService {
    public async addUser(data: AddUserDTO): Promise<any> {
    const {
      fullName,
      email,
      password,
      role,
      projects,
      manager_id,
    } = data;
    if (!password) {
      throw new Error("Password is required.");
    }
    const emailExists = await userRepository.findUserByEmail(email);
    if (emailExists) {
      throw new Error("Email already exists.");
    }
    try {
      const hashedPassword = await userRepository.securePassword(password);
      const newUser = {
        fullName: fullName.trim(),
        email: email.trim(),
        password: hashedPassword,
        role: role.toUpperCase(),
        manager_id: manager_id || null,
        project_id: projects || null,
        lastSeenAt: "No login activity recorded",
      };
      const createdUser = await userRepository.createUser(newUser);
      return createdUser;
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw new Error(error.message || "Failed to create user.");
    }
  }
  public async addDomain(data: { name: string; description: string }) {
    try {
     const {name,description}=data
      const newDomain = {
        name: name,
        description: description,
      };
      const existDomain=await SuperAdminRepository.findOneDomain(name)
      if(existDomain){
        throw new Error("Domain with this name already exists.")
      }
      const saveDomain = await SuperAdminRepository.createDomain(newDomain);
      return saveDomain;
    } catch (error) {
      throw error;
    }
  }
  public async getAllDomain() {
    try {
      return await SuperAdminRepository.listAllDomain();
    } catch (error) {
      throw error;
    }
  }
  public async getUserById(id:string) {
    try {
      return await SuperAdminRepository.getuser(id)
    } catch (error) {
      throw error;
    }
  }
  public async countTask(role:string,date:string) {
    try {
      return await SuperAdminRepository.fetchTaskCount(role,date)
    } catch (error) {
      throw error;
    }
  }
  public async deletetUserById(id:string) {
    try {
      return await SuperAdminRepository.deleteuser(id)
    } catch (error) {
      throw error;
    }
  }
  public async unBlockUserById(id:string) {
    try {
      return await SuperAdminRepository.unBlockUser(id)
    } catch (error) {
      throw error;
    }
  }
  public async BlockUserById(id:string) {
    try {
      return await SuperAdminRepository.BlockUser(id)
    } catch (error) {
      throw error;
    }
  }
  public async getAllProjects(){
    try {
      return await SuperAdminRepository.listAllProject()
    } catch (error) {
      throw error
    }
  }
  public async getAllUsers(){
    try {
      return await SuperAdminRepository.listAllUsers()
    } catch (error) {
      throw error
    }
  }
  public async updateOneUser(data:AddUserDTO){
 
    try {
      return await SuperAdminRepository.editUser(data)
    } catch (error) {
      throw error
    }
  }
  public async addProject(data:any){
    try {
      const {domain,name,description}=data
      const findExistProject=await SuperAdminRepository.findOneProject(name)
      if(findExistProject){
        throw new Error("Project Name is Exist")
      }
      const findDomain=await SuperAdminRepository.findOneDomain(domain as string)
      if(!findDomain){
        throw new Error("domain not found")
      }
      const newProject={
       domain_id:findDomain.id,
        name:name,
        description:description
      }
      const saveProject=await SuperAdminRepository.createProject(newProject)
      return saveProject
    } catch (error) {
      throw error
    }
  }
}
