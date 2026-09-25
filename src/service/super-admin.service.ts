import { superAdminRepository } from "../repositories/super-admin.repository";
import { Role } from "../Enums/Role";
import { AddUserDTO, EditUserDTO } from "../types/user.types";
import {
  assertValidBloodGroup,
  assertValidContactNumber,
  assertValidDate,
  assertValidEmail,
  assertValidFullName,
  assertValidPassword,
  isPresent,
  parseProjectIds,
} from "../utils/userValidation";
import { UserRepository } from "../repositories/user.repository";
import { DomainUpsertDTO } from "../types/domain.types";
import {
  ProjectActivityAction,
  ProjectActivityEntry,
  ProjectPatchDTO,
  ProjectUpsertDTO,
} from "../types/project.types";
import { sendWelcomeEmail } from "../utils/mailer";

// ── Project activity ────────────────────────────────────────────────────────

// Raised when an end date is pushed out with no reason given. Named so the
// controller answers 400 without matching on message text, like the task-side
// validation errors.
export class ProjectValidationError extends Error {
  public readonly name = "ProjectValidationError";
}

const activityId = (): string =>
  "pa_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// A DATE column read back for comparison. Sequelize hands these back as Date
// objects or as "YYYY-MM-DD" depending on the column type, so both are reduced
// to the day — an end date is a day, and comparing timestamps would call a
// same-day save a change.
const dayOf = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return raw.split("T")[0];
};

const activityEntry = (
  action: ProjectActivityAction,
  fields: {
    field?: string | null;
    old_value?: string | null;
    new_value?: string | null;
    reason?: string | null;
    actor_id?: string | null;
    actor_name?: string | null;
  },
): ProjectActivityEntry => ({
  id: activityId(),
  action,
  field: fields.field ?? null,
  old_value: fields.old_value ?? null,
  new_value: fields.new_value ?? null,
  reason: fields.reason ?? null,
  actor_id: fields.actor_id ?? null,
  actor_name: fields.actor_name ?? null,
  created_at: new Date().toISOString(),
});

// A date input that was cleared arrives as "" and must reach a nullable DATE
// column as null — "" is not a date, and the driver would reject it.
const emptyToNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
};

const SuperAdminRepository = new superAdminRepository();
const userRepository = new UserRepository();

// An AM staffs their own team and nothing above it. Any other target role on
// an edit is an escalation and is refused outright.
const AM_ASSIGNABLE_ROLES: string[] = [Role.User, Role.Devloper];
const ALL_ROLES: string[] = Object.values(Role);

// domain_ids may arrive as an array or a comma-separated string
const normalizeIds = (value?: string | string[]): string[] => {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list.map((id) => String(id).trim()).filter(Boolean))];
};

export class superAdminService {
  // Validates the domains a shared user may be linked to. An AM may only pick
  // domains they are linked to; an SP may pick any. Runs before the user row is
  // written so a rejected domain never leaves a shared user with no domains.
  private async resolveSharedUserDomains(
    domain_ids: string | string[] | undefined,
    currentUserId?: string,
    currentUserRole?: string,
    isSharedUser = false,
  ): Promise<string[]> {
    const domainIds = normalizeIds(domain_ids);
    if (!domainIds.length) return [];

    const existing = await SuperAdminRepository.findDomainsByIds(domainIds);
    const existingIds = existing.map((d: any) => d.id);
    const unknown = domainIds.filter((id) => !existingIds.includes(id));
    if (unknown.length) {
      throw new Error(`Domain not found: ${unknown.join(", ")}`);
    }

    // A shared user is assignable to ANY domain, including domains the creating
    // AM is not linked to - that is what makes the user visible to the managers
    // of those domains. The ownership check only applies to non-shared domain
    // links, where an AM has no business reaching outside their own domains.
    if (!isSharedUser && currentUserRole === Role.Admin && currentUserId) {
      const ownDomainIds =
        await SuperAdminRepository.getDomainIdsForUser(currentUserId);
      const notOwned = domainIds.filter((id) => !ownDomainIds.includes(id));
      if (notOwned.length) {
        throw new Error("You can only assign domains you are linked to");
      }
    }

    return domainIds;
  }

  public async addUser(data: AddUserDTO, manager_id?: string, creatorRole?: string): Promise<any> {
    const {
      fullName,
      email,
      password,
      role,
      job_title,
      employee_id,
      contact_number,
      date_of_birth,
      blood_group,
      department,
      work_schedule,
      joining_date,
      require_password_change,
      projects,
      is_shared,
    } = data;

    // Only an SP may hand the new user to a different reporting manager. An AM
    // always owns the users they create - leave-approval routing depends on
    // manager_id pointing at a single approver (see leave.repository.ts).
    const requestedManagerId =
      typeof data.manager_id === "string" && data.manager_id.trim()
        ? data.manager_id.trim()
        : undefined;
    let resolvedManagerId = manager_id;
    if (creatorRole === Role.SuperAdmin && requestedManagerId) {
      const targetManager =
        await SuperAdminRepository.findUserById(requestedManagerId);
      if (!targetManager) {
        throw new Error("Reporting manager not found");
      }
      resolvedManagerId = requestedManagerId;
    }
    const isSharedUser = String(is_shared) === "true";

    if (!password) {
      throw new Error("Password is required.");
    }
    // A shared user is only visible through its domains, so it needs at least one
    let sharedDomainIds: string[] = [];
    if (isSharedUser) {
      sharedDomainIds = await this.resolveSharedUserDomains(
        data.domain_ids,
        manager_id,
        creatorRole,
        true,
      );
      if (!sharedDomainIds.length) {
        throw new Error("A shared user must be assigned to at least one domain");
      }
    }
    const emailExists = await userRepository.findUserByEmail(email);
    if (emailExists) {
      throw new Error("Email already exists.");
    }
    if (employee_id) {
      const empExists =
        await SuperAdminRepository.findUserByEmployeeId(employee_id);
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
        manager_id: resolvedManagerId,
        // A shared user (e.g. a tester spanning several domains) shows up in the
        // user list of every manager linked to the domains they are assigned to,
        // not just the creator's. manager_id still points at the creator so
        // leave approval keeps a single owner.
        is_shared: isSharedUser,
        job_title: job_title?.trim(),
        employee_id: employee_id?.trim(),
        contact_number: contact_number?.trim(),
        date_of_birth: date_of_birth,
        blood_group: blood_group?.trim(),
        department: department?.trim(),
        work_schedule: work_schedule?.trim(),
        joining_date: joining_date,
        require_password_change: require_password_change ,
        lastSeenAt: "No login activity recorded",
      };
      const createdUser = await userRepository.createUser(newUser);
      if (sharedDomainIds.length) {
        await SuperAdminRepository.syncUserDomains(createdUser.id, sharedDomainIds);
      }
      if (projects && projects.trim()) {
        const projectIds = projects
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
        for (const pid of projectIds) {
          await SuperAdminRepository.assignMembers(pid, [createdUser.id]);
        }
      }

      if (data.sendWelcomeEmail) {
        sendWelcomeEmail(email, fullName, password).catch((err) =>
          console.error("Failed to send welcome email:", err.message),
        );
      }

      return createdUser;
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw new Error(error.message || "Failed to create user.");
    }
  }
  public async upsertDomain(
    data: DomainUpsertDTO,
    currentUserId: string,
    currentUserRole: string,
  ) {
    try {
      const { userId, name, description, assigned_am_ids } = data;

      if (!name || !name.trim()) {
        throw new Error("Domain name is required");
      }
      if (!currentUserId) {
        throw new Error("Authenticated user is required");
      }

      if (userId) {
        const existingDomain = await SuperAdminRepository.findDomainById(userId);
        if (!existingDomain) {
          throw new Error("Domain not found");
        }

        if (name.trim() !== existingDomain.name) {
          const duplicateName = await SuperAdminRepository.findDomainByName(
            name.trim(),
          );
          if (duplicateName) {
            throw new Error("Domain with this name already exists");
          }
        }

        const updated = await SuperAdminRepository.updateDomain(userId, {
          name: name.trim(),
          description: description?.trim(),
        });

        if (currentUserRole === "SP" && Array.isArray(assigned_am_ids)) {
          const ids = assigned_am_ids.filter(Boolean);
          if (ids.length > 0) {
            await SuperAdminRepository.assignDomainMembers(userId, ids);
          }
        }

        return updated;
      }

      const existDomain = await SuperAdminRepository.findDomainByName(
        name.trim(),
      );
      if (existDomain) {
        throw new Error("Domain with this name already exists");
      }

      const created = await SuperAdminRepository.createDomain({
        name: name.trim(),
        description: description?.trim(),
        created_by: currentUserId,
      });

      // Build assignment list based on role
      const assignments: string[] = [];
      if (currentUserRole === "SP") {
        if (Array.isArray(assigned_am_ids)) {
          assignments.push(...assigned_am_ids.filter(Boolean));
        }
      } else if (currentUserRole === "AM") {
        // AM cannot assign other AMs; auto-assign self
        assignments.push(currentUserId);
      }

      if (assignments.length > 0) {
        await SuperAdminRepository.assignDomainMembers(created.id, assignments);
      }

      return created;
    } catch (error) {
      throw error;
    }
  }

  public async deleteDomain(
    id: string,
    currentUserId: string,
    currentUserRole: string,
  ) {
    try {
      if (!id) throw new Error("Domain id is required");

      if (currentUserRole !== "SP") {
        const domain = await SuperAdminRepository.findDomainById(id);
        if (!domain) throw new Error("Domain not found");
        if (domain.created_by !== currentUserId) {
          const creator = await SuperAdminRepository.getuser(domain.created_by as string);
          const creatorRole = creator?.user?.role;
          if (creatorRole === "SP") {
            throw new Error("You don't have permission to delete this domain");
          }
          throw new Error("You can only delete domains you created");
        }
      }

      return await SuperAdminRepository.deleteDomain(id);
    } catch (error) {
      throw error;
    }
  }
  // An AM passes isShared=true to get every domain, not just their own. That is
  // the whole point of a shared user: the domains picked here decide which OTHER
  // managers see the user in their team management tab, so the choice has to
  // reach beyond the creator's own domains. resolveSharedUserDomains skips its
  // ownership check for shared users to match - keep the two in step.
  public async getAllDomain(
    currentUserId: string,
    currentUserRole: string,
    isShared = false,
  ) {
    try {
      if (currentUserRole === Role.SuperAdmin || (currentUserRole === Role.Admin && isShared)) {
        return await SuperAdminRepository.listAllDomain();
      }
      return await SuperAdminRepository.listDomainsForUser(currentUserId);
    } catch (error) {
      throw error;
    }
  }
  public async getUserById(id: string) {
    try {
      return await SuperAdminRepository.getuser(id);
    } catch (error) {
      throw error;
    }
  }
  // The set of users an AM may touch: their own team, themselves, and shared
  // users assigned to one of their domains - exactly what /list-users returns
  // them, so every row they can see is a row they can open and save. An SP is
  // unrestricted. Read and write share this check on purpose: a user an AM
  // cannot open is a user an AM cannot edit.
  private async assertCanReachUser(
    target: any,
    currentUserId?: string,
    currentUserRole?: string,
  ): Promise<void> {
    if (currentUserRole !== Role.Admin) return;

    const isOwnTeam = target.manager_id === currentUserId;
    const isSelf = target.id === currentUserId;
    let isSharedDomainPeer = false;
    if (!isOwnTeam && !isSelf && target.is_shared && currentUserId) {
      const domainPeerIds =
        await SuperAdminRepository.getDomainPeerUserIds(currentUserId);
      isSharedDomainPeer = domainPeerIds.includes(target.id);
    }
    if (!isOwnTeam && !isSelf && !isSharedDomainPeer) {
      throw new Error("You do not have access to this user");
    }
  }

  // Full record for the edit modal.
  // SP may read any user. An AM may read their own team, themselves, and shared
  // users assigned to one of their domains - exactly the set /list-users shows
  // them, so every row they can see is a row they can open.
  public async getUserDetails(
    id: string,
    currentUserId?: string,
    currentUserRole?: string,
  ) {
    try {
      if (!id || !String(id).trim()) {
        throw new Error("User id is required");
      }

      const user = await SuperAdminRepository.getUserDetails(String(id).trim());
      if (!user) {
        throw new Error("User not found");
      }

      await this.assertCanReachUser(
        user.get({ plain: true }) as any,
        currentUserId,
        currentUserRole,
      );

      return user;
    } catch (error) {
      throw error;
    }
  }
  public async countTask(role: string, date: string) {
    try {
      return await SuperAdminRepository.fetchTaskCount(role, date);
    } catch (error) {
      throw error;
    }
  }
  public async getTaskCompletionTrend() {
    try {
      return await SuperAdminRepository.fetchTaskCompletionTrend();
    } catch (error) {
      throw error;
    }
  }
  public async getTeamPerformance() {
    try {
      return await SuperAdminRepository.fetchTeamPerformance();
    } catch (error) {
      throw error;
    }
  }
  public async getRecentActivity(limit?: number) {
    try {
      return await SuperAdminRepository.fetchRecentActivity(limit);
    } catch (error) {
      throw error;
    }
  }
  public async getUpcomingDeadlines(limit?: number) {
    try {
      return await SuperAdminRepository.fetchUpcomingDeadlines(limit);
    } catch (error) {
      throw error;
    }
  }
  public async deletetUserById(id: string) {
    try {
      return await SuperAdminRepository.deleteuser(id);
    } catch (error) {
      throw error;
    }
  }
  public async unBlockUserById(id: string) {
    try {
      return await SuperAdminRepository.unBlockUser(id);
    } catch (error) {
      throw error;
    }
  }
  public async BlockUserById(id: string) {
    try {
      return await SuperAdminRepository.BlockUser(id);
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

  public async getAllProjects(
    userId?: string,
    userRole?: string,
    search?: string,
    page?: number,
    limit?: number,
  ) {
    try {
      return await SuperAdminRepository.listAllProjects(
        userId,
        userRole,
        search,
        page,
        limit,
      );
    } catch (error) {
      throw error;
    }
  }
  public async getProject(id: string, userId?: string, userRole?: string) {
    try {
      if (!id) throw new Error("Project id is required");
      return await SuperAdminRepository.findProjectDetail(id, userId, userRole);
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
    is_shared?: string;
    page: number;
    limit: number;
  }) {
    try {
      return await SuperAdminRepository.listAllUsers(filters);
    } catch (error) {
      throw error;
    }
  }

  public async getAllDomainProject() {
    try {
      return await SuperAdminRepository.getDomainHierarchy();
    } catch (error) {
      throw error;
    }
  }
  // PATCH /role-sp/edit-user - backs both tabs of the edit modal.
  //
  // Partial update throughout. The two payloads the modal sends are disjoint:
  // the details tab carries no password, the password tab carries nothing but
  // an id and a password. Only keys actually present are written, so neither
  // tab can wipe what the other owns.
  //
  // "" and absent mean different things here and the distinction is
  // load-bearing: the details tab sends every profile field unconditionally, so
  // a field the manager cleared arrives as "" - normalizeUserPayload turns that
  // into null and the column is cleared. Ignore "" instead and a wrong phone
  // number could never be blanked. Identity fields (fullName, email, role) opt
  // out of that rule: "" there is rejected, not applied.
  public async updateOneUser(
    data: EditUserDTO,
    currentUserId?: string,
    currentUserRole?: string,
  ) {
    try {
      const id = String(data.id ?? "").trim();
      if (!id) throw new Error("User id is required");

      const existingRecord = await SuperAdminRepository.getUserDetails(id);
      if (!existingRecord) throw new Error("User not found");
      const existing = existingRecord.get({ plain: true }) as any;

      await this.assertCanReachUser(existing, currentUserId, currentUserRole);

      const isAdminCaller = currentUserRole === Role.Admin;
      // Built key by key from what the caller actually sent. Nothing reaches
      // the repository by accident - in particular the AM-forbidden fields are
      // dropped here rather than filtered downstream.
      const update: EditUserDTO = { id };

      // --- role ------------------------------------------------------------
      // Only an actual change is policed. The modal echoes the stored role back
      // on every save, so re-sending the same value stays a no-op even when the
      // caller could not have granted that role from scratch.
      const requestedRole = data.role
        ? String(data.role).trim().toUpperCase()
        : undefined;
      if (requestedRole && requestedRole !== existing.role) {
        if (!ALL_ROLES.includes(requestedRole)) {
          throw new Error("Role is not valid");
        }
        if (existing.id === currentUserId) {
          throw new Error("You cannot change your own role");
        }
        if (requestedRole === Role.SuperAdmin && currentUserRole !== Role.SuperAdmin) {
          throw new Error("Only a super admin can assign the SP role");
        }
        if (isAdminCaller) {
          if (!AM_ASSIGNABLE_ROLES.includes(requestedRole)) {
            throw new Error("An admin manager may only assign the USER or DEVLOPER role");
          }
          // ...and may not pull a peer or an SP down into their own team either
          if (!AM_ASSIGNABLE_ROLES.includes(existing.role)) {
            throw new Error("An admin manager cannot change the role of this user");
          }
        }
        update.role = requestedRole;
      }

      // --- reporting manager -----------------------------------------------
      // The modal echoes manager_id back untouched so a save never re-parents
      // the user; a blank one is ignored outright because leave approval routes
      // through manager_id and needs a single owner.
      if (
        isPresent(data.manager_id) &&
        String(data.manager_id).trim() !== existing.manager_id
      ) {
        if (isAdminCaller) {
          throw new Error("An admin manager cannot change the reporting manager");
        }
        const nextManagerId = String(data.manager_id).trim();
        const targetManager = await SuperAdminRepository.findUserById(nextManagerId);
        if (!targetManager) throw new Error("Reporting manager not found");
        update.manager_id = nextManagerId;
      }

      // --- shared flag ------------------------------------------------------
      // SP-only. AM saves omit it; if one arrives anyway it is tolerated when it
      // matches what is stored, and never written.
      if (data.is_shared !== undefined) {
        const requestedShared = String(data.is_shared) === "true";
        if (isAdminCaller) {
          if (requestedShared !== Boolean(existing.is_shared)) {
            throw new Error("An admin manager cannot change the shared flag");
          }
        } else {
          update.is_shared = requestedShared;
        }
      }

      // --- identity ---------------------------------------------------------
      assertValidFullName(data.fullName);
      assertValidEmail(data.email);
      if (data.fullName !== undefined) update.fullName = String(data.fullName).trim();
      if (data.email !== undefined) {
        const email = String(data.email).trim();
        if (email.toLowerCase() !== String(existing.email ?? "").toLowerCase()) {
          const taken = await SuperAdminRepository.findUserByEmail(email, id);
          if (taken) throw new Error("Email already exists.");
        }
        update.email = email;
      }

      // --- profile ----------------------------------------------------------
      assertValidContactNumber(data.contact_number);
      assertValidBloodGroup(data.blood_group);
      assertValidDate(data.date_of_birth, "Date of birth");
      assertValidDate(data.joining_date, "Joining date");

      if (data.employee_id !== undefined) {
        if (isPresent(data.employee_id) && data.employee_id !== existing.employee_id) {
          const taken = await SuperAdminRepository.findUserByEmployeeId(
            data.employee_id,
            id,
          );
          if (taken) throw new Error("Employee ID already exists.");
        }
        update.employee_id = data.employee_id;
      }
      if (data.job_title !== undefined) update.job_title = data.job_title;
      if (data.contact_number !== undefined) update.contact_number = data.contact_number;
      if (data.date_of_birth !== undefined) update.date_of_birth = data.date_of_birth;
      if (data.blood_group !== undefined) {
        update.blood_group = isPresent(data.blood_group)
          ? String(data.blood_group).trim().toUpperCase()
          : null;
      }
      if (data.department !== undefined) update.department = data.department;
      if (data.work_schedule !== undefined) update.work_schedule = data.work_schedule;
      if (data.joining_date !== undefined) update.joining_date = data.joining_date;
      if (data.require_password_change !== undefined) {
        update.require_password_change = data.require_password_change;
      }

      // --- password ---------------------------------------------------------
      // Arrives through the same handler as the profile fields, so the hashing
      // has to happen here or a raw password lands in the column. "" is read as
      // "not sent", never as a request to blank the credential.
      //
      // This does NOT end the user's existing sessions - see the note on
      // session invalidation in docs/edit-user-modal.md.
      if (data.password !== undefined && String(data.password) !== "") {
        assertValidPassword(data.password);
        update.password = await userRepository.securePassword(String(data.password));
      }

      // --- domains (shared users only) --------------------------------------
      let sharedDomainIds: string[] | undefined;
      if (data.domain_ids !== undefined) {
        // The edit form may omit is_shared while still sending domain_ids, so
        // fall back to the stored flag rather than assuming not-shared.
        const isSharedUser =
          update.is_shared !== undefined
            ? update.is_shared
            : Boolean(existing.is_shared);

        sharedDomainIds = await this.resolveSharedUserDomains(
          data.domain_ids,
          currentUserId,
          currentUserRole,
          isSharedUser,
        );
        if (isSharedUser && !sharedDomainIds.length) {
          throw new Error("A shared user must be assigned to at least one domain");
        }
      }

      // --- projects ---------------------------------------------------------
      // Full replacement, not a delta: "1,4,9" makes the set exactly {1,4,9}
      // and "" detaches from every project. Every id is checked before anything
      // is written, so a bad one cannot leave the user half-reassigned.
      let projectIds: string[] | undefined;
      if (data.projects !== undefined) {
        projectIds = parseProjectIds(data.projects);
        if (projectIds.length) {
          const found = await SuperAdminRepository.findProjectsByIds(projectIds);
          const foundIds = found.map((p: any) => String(p.id));
          const unknown = projectIds.filter((pid) => !foundIds.includes(pid));
          if (unknown.length) {
            throw new Error("Project not found: " + unknown.join(", "));
          }
        }
      }

      await SuperAdminRepository.editUser(update);

      if (sharedDomainIds !== undefined) {
        await SuperAdminRepository.syncUserDomains(id, sharedDomainIds);
      }
      if (projectIds !== undefined) {
        await SuperAdminRepository.syncUserProjects(id, projectIds);
      }

      // Re-read so the modal gets the saved row with refreshed project and
      // domain lists, in the same shape GET /user-details handed it.
      return await SuperAdminRepository.getUserDetails(id);
    } catch (error) {
      throw error;
    }
  }

  // PATCH /role-sp/reset-user-password - the password tab on its own.
  // Same guards, no profile surface at all, so a stray fullName in the body
  // cannot ride along with a password reset.
  public async resetUserPassword(
    id: string,
    password: string,
    currentUserId?: string,
    currentUserRole?: string,
  ) {
    if (!String(id ?? "").trim()) throw new Error("User id is required");
    if (password === undefined || String(password) === "") {
      throw new Error("Password is required.");
    }
    return await this.updateOneUser(
      { id: String(id).trim(), password: String(password) },
      currentUserId,
      currentUserRole,
    );
  }

  public async upsertProject(data: ProjectUpsertDTO) {
    try {
      const {
        id,
        name,
        description,
        domain_id,
        client_department,
        start_date,
        end_date,
        status,
        created_by,
      } = data;

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
          const duplicate = await SuperAdminRepository.findProjectByName(
            name.trim(),
            id,
          );
          if (duplicate) {
            throw new Error("Project with this name already exists");
          }
        }

        // The legacy create-or-replace path still edits, so it logs too —
        // otherwise a save through this route would be a hole in the history,
        // and an end date pushed out here would escape the reason rule that
        // PATCH enforces.
        const entries = await this.buildProjectActivity(
          existing,
          projectData,
          (data as any).extension_reason,
          created_by,
        );
        const updated = await SuperAdminRepository.updateProject(id, projectData);
        await SuperAdminRepository.appendProjectActivity(id, entries);
        return updated;
      }
      const existProject = await SuperAdminRepository.findProjectByName(
        name.trim(),
      );
      if (existProject) {
        throw new Error("Project with this name already exists");
      }

      if (created_by) projectData.created_by = created_by;
      const project = await SuperAdminRepository.createProject(projectData);
      // The first entry in every project's log, so the Activity panel always
      // has a beginning rather than starting at the first edit.
      await SuperAdminRepository.appendProjectActivity(project.id, [
        activityEntry("created", {
          actor_id: created_by ?? null,
          actor_name: await this.actorName(created_by),
          new_value: projectData.name,
        }),
      ]);
      if (created_by) {
        // The creator's own membership is not logged: it is part of creating
        // the project, not a later decision about who is on it.
        await SuperAdminRepository.assignMembers(project.id, [created_by]);
      }

      return project;
    } catch (error) {
      throw error;
    }
  }

  // PATCH /role-sp/project?id=<id> — the edit modal's save.
  //
  // Separate from upsertProject rather than folded into it. That one is the
  // wizard's create-or-replace and requires `name` and `domain_id` on every
  // call; this one leaves out what the caller leaves out, which is what a
  // modal that sends only the changed fields needs.
  //
  // Unlike POST /project it enforces the SAME per-project visibility as
  // GET /project?id=. A new write route with no authorization would be
  // shipping a known hole knowingly; POST is untouched, so nothing regresses.
  public async patchProject(
    id: string,
    body: ProjectPatchDTO,
    userId?: string,
    userRole?: string,
  ) {
    try {
      if (!id) throw new Error("Project id is required");

      // Reads through the visibility rule, so a project this caller may not
      // see is "not found" here exactly as it is on the GET.
      const visible = await SuperAdminRepository.findProjectVisibleById(
        id,
        userId,
        userRole,
      );
      if (!visible) throw new Error("Project not found");

      const patch: any = {};

      if (body.name !== undefined) {
        const name = String(body.name ?? "").trim();
        if (!name) throw new Error("Project name is required");
        // Only when it actually changed: re-saving a project under its own
        // name must not collide with itself.
        if (name !== visible.name) {
          const duplicate = await SuperAdminRepository.findProjectByName(
            name,
            id,
          );
          if (duplicate) {
            throw new Error("Project with this name already exists");
          }
        }
        patch.name = name;
      }

      if (body.domain_id !== undefined) {
        if (!body.domain_id) throw new Error("Domain is required");
        const domain = await SuperAdminRepository.findDomainById(
          body.domain_id,
        );
        if (!domain) throw new Error("Domain not found");
        patch.domain_id = body.domain_id;
      }

      if (body.status !== undefined) {
        const validStatuses = ["active", "on_hold", "paused", "completed"];
        if (!validStatuses.includes(String(body.status))) {
          throw new Error(
            "Invalid status. Must be: active, on_hold, paused, completed",
          );
        }
        patch.status = body.status;
      }

      // Nullable text: "" from a cleared input means null, not an empty
      // string, so the column ends up consistent with what create writes.
      if (body.description !== undefined) {
        const value = body.description === null ? null : String(body.description).trim();
        patch.description = value || null;
      }
      if (body.client_department !== undefined) {
        const value =
          body.client_department === null
            ? null
            : String(body.client_department).trim();
        patch.client_department = value || null;
      }

      if (body.start_date !== undefined) {
        patch.start_date = emptyToNull(body.start_date);
      }
      if (body.end_date !== undefined) {
        patch.end_date = emptyToNull(body.end_date);
      }

      // Checked against the row as it will be, not as it was: moving only the
      // start date still has to land before the due date already stored.
      const effectiveStart =
        patch.start_date !== undefined ? patch.start_date : visible.start_date;
      const effectiveEnd =
        patch.end_date !== undefined ? patch.end_date : visible.end_date;
      if (
        effectiveStart &&
        effectiveEnd &&
        new Date(effectiveEnd).getTime() < new Date(effectiveStart).getTime()
      ) {
        throw new Error("End date cannot be before start date");
      }

      if (Object.keys(patch).length === 0) {
        throw new Error(
          "Nothing to update: send name, description, domain_id, client_department, start_date, end_date or status",
        );
      }

      // One activity entry per field that actually MOVED, built against the
      // stored row before the write. Comparing after the update would find
      // nothing changed, and comparing against the request would log fields the
      // form resent unchanged — the log has to say what happened, not what was
      // submitted.
      const entries = await this.buildProjectActivity(
        visible,
        patch,
        body.extension_reason,
        userId,
      );

      await SuperAdminRepository.updateProject(id, patch);
      await SuperAdminRepository.appendProjectActivity(id, entries);

      // The same read GET /project?id= returns, so the modal can close on the
      // response instead of refetching the list to see its own edit.
      return await SuperAdminRepository.findProjectDetail(id, userId, userRole);
    } catch (error) {
      throw error;
    }
  }

  // The diff, as activity entries. Also the gate on `extension_reason`, which
  // is why it runs BEFORE the write: a push with no reason must leave the
  // project untouched, not logged-but-unexplained.
  //
  // Only `end_date` moving LATER is an extension. Pulling it in is a
  // due_date_changed — a project finishing sooner has not slipped, and counting
  // it would inflate the number the badge reports. Same rule tasks follow.
  private async buildProjectActivity(
    existing: any,
    patch: any,
    extension_reason: unknown,
    actorId?: string,
  ): Promise<ProjectActivityEntry[]> {
    const entries: ProjectActivityEntry[] = [];
    const actor_name = await this.actorName(actorId);
    const base = { actor_id: actorId ?? null, actor_name };

    if (patch.end_date !== undefined) {
      const before = dayOf(existing.end_date);
      const after = dayOf(patch.end_date);
      if (before !== after) {
        // Later than before — including a first date set on a project that had
        // none, which is still a commitment being made and worth a reason.
        const isExtension = !before || (after !== null && after > before);
        if (isExtension) {
          const reason = String(extension_reason ?? "").trim();
          if (!reason) {
            throw new ProjectValidationError(
              "extension_reason is required when the end date moves later",
            );
          }
          entries.push(
            activityEntry("extended", {
              ...base,
              field: "end_date",
              old_value: before,
              new_value: after,
              reason,
            }),
          );
        } else {
          entries.push(
            activityEntry("due_date_changed", {
              ...base,
              field: "end_date",
              old_value: before,
              new_value: after,
            }),
          );
        }
      }
    }

    if (patch.status !== undefined && patch.status !== existing.status) {
      entries.push(
        activityEntry("status_changed", {
          ...base,
          field: "status",
          old_value: existing.status ?? null,
          new_value: patch.status,
        }),
      );
    }

    if (patch.name !== undefined && patch.name !== existing.name) {
      entries.push(
        activityEntry("renamed", {
          ...base,
          field: "name",
          old_value: existing.name ?? null,
          new_value: patch.name,
        }),
      );
    }

    // Everything else is one `updated` row each, so the panel can say which
    // field moved without the log needing an action name per column.
    const plain: Array<[string, (row: any) => string | null]> = [
      ["description", (row) => row.description ?? null],
      ["domain_id", (row) => row.domain_id ?? null],
      ["client_department", (row) => row.client_department ?? null],
      ["start_date", (row) => dayOf(row.start_date)],
    ];
    for (const [field, read] of plain) {
      if (patch[field] === undefined) continue;
      const before = read(existing);
      const after = field === "start_date" ? dayOf(patch[field]) : patch[field] ?? null;
      if (before === after) continue;
      entries.push(
        activityEntry("updated", {
          ...base,
          field,
          old_value: before,
          new_value: after,
        }),
      );
    }

    return entries;
  }

  // The actor's name, snapshotted onto the entry so it still reads correctly
  // after the user is deleted. Live names still win on read.
  private async actorName(actorId?: string): Promise<string | null> {
    if (!actorId) return null;
    try {
      const [user]: any = await userRepository.findUsersLite([actorId]);
      return user?.fullName ?? null;
    } catch {
      return null;
    }
  }

  public async updateProjectStatus(id: string, status: string, actorId?: string) {
    try {
      if (!id) throw new Error("Project id is required");
      if (!status) throw new Error("Status is required");
      const validStatuses = ["active", "on_hold", "paused", "completed"];
      if (!validStatuses.includes(status)) {
        throw new Error(
          "Invalid status. Must be: active, on_hold, paused, completed",
        );
      }
      // Read first: the old value is gone the moment the update lands.
      const before = await SuperAdminRepository.findProjectById(id);
      const updated = await SuperAdminRepository.updateProjectStatus(
        id,
        status as "active" | "on_hold" | "paused" | "completed",
      );
      if (before && before.status !== status) {
        await SuperAdminRepository.appendProjectActivity(id, [
          activityEntry("status_changed", {
            field: "status",
            old_value: before.status ?? null,
            new_value: status,
            actor_id: actorId ?? null,
            actor_name: await this.actorName(actorId),
          }),
        ]);
      }
      return updated;
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

  public async assignProjectMembers(
    project_id: string,
    user_ids: string[],
    actorId?: string,
  ) {
    try {
      if (!project_id) throw new Error("Project id is required");
      if (!user_ids || !user_ids.length)
        throw new Error("At least one user is required");

      // Who was actually NOT on the project before this call. assignMembers
      // uses ignoreDuplicates, so re-sending the whole picker list is a no-op
      // for people already on it — and logging those would fill the history
      // with additions that never happened.
      const added = await this.newMemberIds(project_id, user_ids);

      const result = await SuperAdminRepository.assignMembers(
        project_id,
        user_ids,
      );
      await this.logMemberChange(project_id, added, "member_added", actorId);
      return result;
    } catch (error) {
      throw error;
    }
  }

  // The ids in `user_ids` that do not already have a membership row.
  private async newMemberIds(
    project_id: string,
    user_ids: string[],
  ): Promise<string[]> {
    const existing = await SuperAdminRepository.projectMemberIds(project_id);
    const have = new Set(existing);
    return [...new Set(user_ids)].filter((id) => !have.has(id));
  }

  // One entry per person, each naming them — a single "3 members added" row
  // would not survive somebody asking which three.
  private async logMemberChange(
    project_id: string,
    user_ids: string[],
    action: ProjectActivityAction,
    actorId?: string,
  ) {
    if (!user_ids.length) return;
    const actor_name = await this.actorName(actorId);
    const people = await userRepository.findUsersLite(user_ids);
    const names = new Map(people.map((u: any) => [u.id, u.fullName]));
    await SuperAdminRepository.appendProjectActivity(
      project_id,
      user_ids.map((user_id) =>
        activityEntry(action, {
          field: user_id,
          // The person's name at the time, so the entry still reads after they
          // are deleted. old/new carry it by direction: added lands in
          // new_value, removed in old_value.
          new_value: action === "member_added" ? names.get(user_id) ?? user_id : null,
          old_value: action === "member_removed" ? names.get(user_id) ?? user_id : null,
          actor_id: actorId ?? null,
          actor_name,
        }),
      ),
    );
  }

  public async assignProjectDomainToUser(project_id: string, user_id: string) {
    try {
      if (!project_id || !user_id) return;
      const project = await SuperAdminRepository.findProjectById(project_id);
      const domainId = (project as any)?.domain_id;
      if (!domainId) return;
      await SuperAdminRepository.assignDomainMembers(domainId, [user_id]);
    } catch (error) {
      throw error;
    }
  }

  public async removeProjectMembers(
    project_id: string,
    user_ids: string[],
    actorId?: string,
  ) {
    try {
      if (!project_id) throw new Error("Project id is required");
      if (!user_ids || !user_ids.length)
        throw new Error("At least one user is required");

      // Read the membership on both sides rather than trusting the request:
      // removing an AM also removes their direct reports, so the people who
      // actually left is wider than the list that was sent.
      const before = await SuperAdminRepository.projectMemberIds(project_id);
      const result = await SuperAdminRepository.removeMembers(
        project_id,
        user_ids,
      );
      const after = new Set(
        await SuperAdminRepository.projectMemberIds(project_id),
      );
      const removed = before.filter((id) => !after.has(id));

      await this.logMemberChange(
        project_id,
        removed,
        "member_removed",
        actorId,
      );
      return result;
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
