import { superAdminRepository } from "../repositories/super-admin.repository";
import { AddUserDTO } from "../types/user.types";
import { UserRepository } from "../repositories/user.repository";
import { DomainUpsertDTO } from "../types/domain.types";
import { ProjectUpsertDTO } from "../types/project.types";

const SuperAdminRepository = new superAdminRepository();
const userRepository = new UserRepository();
export class superAdminService {
    public async addUser(data: AddUserDTO): Promise<any> {
    const {
      fullName, email, password, role, manager_id,
      job_title, employee_id, contact_number, date_of_birth,
      blood_group, department, work_schedule, joining_date,
      require_password_change, projects,
    } = data;

    if (!password) {
      throw new Error("Password is required.");
    }
    const emailExists = await userRepository.findUserByEmail(email);
    if (emailExists) {
      throw new Error("Email already exists.");
    }
    if (employee_id) {
      const empExists = await SuperAdminRepository.findUserByEmployeeId(employee_id);
      if (empExists) {
        throw new Error("Employee ID already exists.");
      }
    }

    try {
      const hashedPassword = await userRepository.securePassword(password);
      const newUser: any = {
        fullName: fullName.trim(),
        email: email.trim(),
        password: hashedPassword,
        role: role.toUpperCase(),
        manager_id: manager_id ,
        job_title: job_title?.trim() ,
        employee_id: employee_id?.trim() ,
        contact_number: contact_number?.trim() ,
        date_of_birth: date_of_birth ,
        blood_group: blood_group?.trim() ,
        department: department?.trim() ,
        work_schedule: work_schedule?.trim(),
        joining_date: joining_date ,
        require_password_change: require_password_change || false,
        lastSeenAt: "No login activity recorded",
      };
      const createdUser = await userRepository.createUser(newUser);
      if (projects && projects.trim()) {
        const projectIds = projects.split(",").map((id: string) => id.trim()).filter(Boolean);
        for (const pid of projectIds) {
          await SuperAdminRepository.assignMembers(pid, [createdUser.id]);
        }
      }
      return createdUser;
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw new Error(error.message || "Failed to create user.");
    }
  }
  public async upsertDomain(data: DomainUpsertDTO) {
    try {
      const { id, name, description } = data;

      if (!name || !name.trim()) {
        throw new Error("Domain name is required");
      }
      if (id) {
        const existingDomain = await SuperAdminRepository.findDomainById(id);
        if (!existingDomain) {
          throw new Error("Domain not found");
        }

     
        if (name.trim() !== existingDomain.name) {
          const duplicateName = await SuperAdminRepository.findDomainByName(name.trim());
          if (duplicateName) {
            throw new Error("Domain with this name already exists");
          }
        }

        return await SuperAdminRepository.updateDomain(id, {
          name: name.trim(),
          description: description?.trim(),
        });
      }
      const existDomain = await SuperAdminRepository.findDomainByName(name.trim());
      if (existDomain) {
        throw new Error("Domain with this name already exists");
      }

      return await SuperAdminRepository.createDomain({
        name: name.trim(),
        description: description?.trim(),
      });
    } catch (error) {
      throw error;
    }
  }

  public async deleteDomain(id: string) {
    try {
      if (!id) throw new Error("Domain id is required");
      return await SuperAdminRepository.deleteDomain(id);
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
  public async getProjectStats(userId?: string, userRole?: string) {
    try {
      return await SuperAdminRepository.getProjectStats(userId, userRole);
    } catch (error) {
      throw error;
    }
  }

  public async getAllProjects(userId?: string, userRole?: string, search?: string) {
    try {
      return await SuperAdminRepository.listAllProjects(userId, userRole, search);
    } catch (error) {
      throw error;
    }
  }
  public async getAllUsers(filters: {
    search?: string;
    role?: string;
    isBlocked?: string;
    project_id?: string;
    manager_id?: string;
    page: number;
    limit: number;
  }) {
    try {
      return await SuperAdminRepository.listAllUsers(filters);
    } catch (error) {
      throw error;
    }
  }

  public async getAllDomainProject(){
    try {
      return await SuperAdminRepository.getDomainHierarchy()
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
  public async upsertProject(data: ProjectUpsertDTO) {
    try {
      const { id, name, description, domain_id, client_department, start_date, end_date, status, created_by } = data;

      if (!name || !name.trim()) {
        throw new Error("Project name is required");
      }
      if (!domain_id) {
        throw new Error("Domain is required");
      }
      const domain = await SuperAdminRepository.findDomainById(domain_id);
      if (!domain) {
        throw new Error("Domain not found");
      }

      const projectData: any = {
        name: name.trim(),
        description: description?.trim(),
        domain_id,
        client_department: client_department?.trim() || null,
        start_date: start_date || null,
        end_date: end_date || null,
      };
      if (status) projectData.status = status;

      if (id) {
        const existing = await SuperAdminRepository.findProjectById(id);
        if (!existing) {
          throw new Error("Project not found");
        }
        if (name.trim() !== existing.name) {
          const duplicate = await SuperAdminRepository.findProjectByName(name.trim(), id);
          if (duplicate) {
            throw new Error("Project with this name already exists");
          }
        }

        return await SuperAdminRepository.updateProject(id, projectData);
      }
      const existProject = await SuperAdminRepository.findProjectByName(name.trim());
      if (existProject) {
        throw new Error("Project with this name already exists");
      }

      if (created_by) projectData.created_by = created_by;
      const project = await SuperAdminRepository.createProject(projectData);

      // Auto-assign the creator as a project member
      if (created_by) {
        await SuperAdminRepository.assignMembers(project.id, [created_by]);
      }

      return project;
    } catch (error) {
      throw error;
    }
  }

  public async updateProjectStatus(id: string, status: string) {
    try {
      if (!id) throw new Error("Project id is required");
      if (!status) throw new Error("Status is required");
      const validStatuses = ["active", "on_hold", "paused", "completed"];
      if (!validStatuses.includes(status)) {
        throw new Error("Invalid status. Must be: active, on_hold, paused, completed");
      }
      return await SuperAdminRepository.updateProjectStatus(id, status as "active" | "on_hold" | "paused" | "completed");
    } catch (error) {
      throw error;
    }
  }

  public async deleteProject(id: string) {
    try {
      if (!id) throw new Error("Project id is required");
      return await SuperAdminRepository.deleteProject(id);
    } catch (error) {
      throw error;
    }
  }

  public async assignProjectMembers(project_id: string, user_ids: string[]) {
    try {
      if (!project_id) throw new Error("Project id is required");
      if (!user_ids || !user_ids.length) throw new Error("At least one user is required");
      return await SuperAdminRepository.assignMembers(project_id, user_ids);
    } catch (error) {
      throw error;
    }
  }

  public async removeProjectMembers(project_id: string, user_ids: string[]) {
    try {
      if (!project_id) throw new Error("Project id is required");
      if (!user_ids || !user_ids.length) throw new Error("At least one user is required");
      return await SuperAdminRepository.removeMembers(project_id, user_ids);
    } catch (error) {
      throw error;
    }
  }

  public async getProjectMembers(project_id: string) {
    try {
      if (!project_id) throw new Error("Project id is required");
      return await SuperAdminRepository.getProjectMembers(project_id);
    } catch (error) {
      throw error;
    }
  }

}
