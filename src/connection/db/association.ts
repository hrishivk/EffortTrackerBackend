import { DailyTaskLog, initDailyTaskLogModel } from "../models/daily_task_logs";
import initDomain, { Domain } from "../models/domain";
import initDomainAssignmentModel, { DomainAssignment } from "../models/domain_assignment";
import initProjectModel, { Project } from "../models/project";
import initProjectMemberModel, { ProjectMember } from "../models/project_member";
import { initTaskModel, Task } from "../models/tasks";
import initTaskGroupModel, { TaskGroup } from "../models/task_group";
import initUserModel, { User } from "../models/user";
import initLeaveModel, { Leave } from "../models/leave";
import initLeaveBalanceModel, { LeaveBalance } from "../models/leave_balance";
import initNotificationModel, { Notification } from "../models/notification";
import initAttendanceModel, { Attendance } from "../models/attendance";
import initWorkspaceModel, { Workspace } from "../models/workspace";
import initRoomModel, { Room } from "../models/room";
import initRoomMemberModel, { RoomMember } from "../models/room_member";
import initWorkspaceUnlockModel, { WorkspaceUnlock } from "../models/workspace_unlock";
import { Sequelize } from "sequelize";

export class Associations {
  static initialize() {
    // Domain <-> Project
    Project.belongsTo(Domain, {
      foreignKey: "domain_id",
      as: "domain",
      onDelete: "CASCADE",
    });
    Domain.hasMany(Project, {
      foreignKey: "domain_id",
      as: "projects",
      onDelete: "CASCADE",
    });

    // Domain <-> User (creator)
    Domain.belongsTo(User, {
      foreignKey: "created_by",
      as: "creator",
      onDelete: "SET NULL",
    });
    User.hasMany(Domain, {
      foreignKey: "created_by",
      as: "createdDomains",
    });

    // Domain <-> User (many-to-many through DomainAssignment)
    Domain.belongsToMany(User, {
      through: DomainAssignment,
      foreignKey: "domain_id",
      otherKey: "user_id",
      as: "assignedUsers",
    });
    User.belongsToMany(Domain, {
      through: DomainAssignment,
      foreignKey: "user_id",
      otherKey: "domain_id",
      as: "assignedDomains",
    });
    DomainAssignment.belongsTo(Domain, {
      foreignKey: "domain_id",
      as: "domain",
    });
    DomainAssignment.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
    });
    Domain.hasMany(DomainAssignment, {
      foreignKey: "domain_id",
      as: "domainAssignments",
    });
    User.hasMany(DomainAssignment, {
      foreignKey: "user_id",
      as: "domainAssignments",
    });

    // Project <-> User (many-to-many through ProjectMember)
    Project.belongsToMany(User, {
      through: ProjectMember,
      foreignKey: "project_id",
      otherKey: "user_id",
      as: "members",
    });
    User.belongsToMany(Project, {
      through: ProjectMember,
      foreignKey: "user_id",
      otherKey: "project_id",
      as: "projects",
    });

    // ProjectMember direct associations
    ProjectMember.belongsTo(Project, {
      foreignKey: "project_id",
      as: "project",
    });
    ProjectMember.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
    });
    Project.hasMany(ProjectMember, {
      foreignKey: "project_id",
      as: "projectMembers",
    });
    User.hasMany(ProjectMember, {
      foreignKey: "user_id",
      as: "projectMemberships",
    });

    // User <-> Manager (self-referencing)
    User.belongsTo(User, {
      foreignKey: "manager_id",
      as: "manager",
    });

    // User <-> DailyTaskLog
    User.hasMany(DailyTaskLog, {
      foreignKey: "assigned_to",
      as: "dailyLogs",
      onDelete: "CASCADE",
    });
    DailyTaskLog.belongsTo(User, {
      foreignKey: "assigned_to",
      as: "assignedUser",
      onDelete: "CASCADE",
    });
    DailyTaskLog.belongsTo(User, {
      foreignKey: "created_by",
      as: "creator",
      onDelete: "CASCADE",
    });

    // DailyTaskLog <-> Project
    DailyTaskLog.belongsTo(Project, {
      foreignKey: "project_id",
      as: "project",
      onDelete: "CASCADE",
    });
    Project.hasMany(DailyTaskLog, {
      foreignKey: "project_id",
      as: "dailyLogs",
    });

    // DailyTaskLog <-> Task
    DailyTaskLog.hasMany(Task, {
      foreignKey: "daily_log_id",
      as: "tasks",
      onDelete: "CASCADE",
    });
    Task.belongsTo(DailyTaskLog, {
      foreignKey: "daily_log_id",
      as: "dailyLog",
      onDelete: "CASCADE",
    });

    // Task <-> Project
    Task.belongsTo(Project, {
      foreignKey: "project_id",
      as: "project",
      onDelete: "CASCADE",
    });
    Project.hasMany(Task, {
      foreignKey: "project_id",
      as: "tasks",
    });

    // Task <-> Task (subtasks). A subtask is a child row in the same table, so
    // it inherits status, priority, dates, the session timer and group lanes.
    Task.hasMany(Task, {
      foreignKey: "parent_id",
      as: "subtasks",
      onDelete: "CASCADE",
    });
    Task.belongsTo(Task, {
      foreignKey: "parent_id",
      as: "parent",
      onDelete: "CASCADE",
    });

    // Task <-> TaskGroup
    // A card with group_id set sits in that group's lane instead of its status
    // lane. SET NULL so deleting a group returns its tasks to their status lane
    // rather than deleting real work.
    Task.belongsTo(TaskGroup, {
      foreignKey: "group_id",
      as: "group",
      onDelete: "SET NULL",
    });
    TaskGroup.hasMany(Task, {
      foreignKey: "group_id",
      as: "tasks",
      onDelete: "SET NULL",
    });

    // TaskGroup <-> User (owner) — groups are scoped to the board they belong to
    TaskGroup.belongsTo(User, {
      foreignKey: "user_id",
      as: "owner",
      onDelete: "CASCADE",
    });
    User.hasMany(TaskGroup, {
      foreignKey: "user_id",
      as: "taskGroups",
    });

    // Leave <-> User
    Leave.belongsTo(User, {
      foreignKey: "user_id",
      as: "applicant",
      onDelete: "CASCADE",
    });
    Leave.belongsTo(User, {
      foreignKey: "manager_id",
      as: "manager",
    });
    Leave.belongsTo(User, {
      foreignKey: "admin_id",
      as: "admin",
    });
    User.hasMany(Leave, {
      foreignKey: "user_id",
      as: "leaves",
    });

    // LeaveBalance <-> User
    LeaveBalance.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    User.hasMany(LeaveBalance, {
      foreignKey: "user_id",
      as: "leaveBalances",
    });

    // Notification <-> User
    Notification.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    User.hasMany(Notification, {
      foreignKey: "user_id",
      as: "notifications",
    });

    // ── Workspaces / Rooms / Room members ──
    //
    // A workspace covers one project and holds many rooms; a room holds many
    // users. CASCADE all the way down: a room is meaningless without its
    // workspace, and an assignment without its room.

    // Workspace <-> Project (the one project a workspace covers)
    Workspace.belongsTo(Project, {
      foreignKey: "project_id",
      as: "project",
      onDelete: "SET NULL",
    });
    Project.hasMany(Workspace, {
      foreignKey: "project_id",
      as: "workspaces",
    });

    // Workspace <-> User (creator, taken from the session)
    Workspace.belongsTo(User, {
      foreignKey: "created_by",
      as: "creator",
      onDelete: "SET NULL",
    });
    User.hasMany(Workspace, {
      foreignKey: "created_by",
      as: "createdWorkspaces",
    });

    // Workspace <-> User (whoever marked it completed). SET NULL, not CASCADE:
    // a completion outlives the person who recorded it, same rule as
    // room_members.decided_by.
    Workspace.belongsTo(User, {
      foreignKey: "completed_by",
      as: "completedBy",
      onDelete: "SET NULL",
    });

    // Workspace <-> Room
    Room.belongsTo(Workspace, {
      foreignKey: "workspace_id",
      as: "workspace",
      onDelete: "CASCADE",
    });
    Workspace.hasMany(Room, {
      foreignKey: "workspace_id",
      as: "rooms",
      onDelete: "CASCADE",
    });

    // Room <-> Project (denormalised; kept for multi-project workspaces later)
    Room.belongsTo(Project, {
      foreignKey: "project_id",
      as: "project",
      onDelete: "SET NULL",
    });
    Project.hasMany(Room, {
      foreignKey: "project_id",
      as: "rooms",
    });

    // Room <-> User (many-to-many through RoomMember). The `members` alias is
    // what the create response and every workspace read embed, so a room's
    // people arrive with the room instead of costing an N+1 of lookups.
    Room.belongsToMany(User, {
      through: RoomMember,
      foreignKey: "room_id",
      otherKey: "user_id",
      as: "members",
    });
    User.belongsToMany(Room, {
      through: RoomMember,
      foreignKey: "user_id",
      otherKey: "room_id",
      as: "rooms",
    });

    // RoomMember direct associations
    RoomMember.belongsTo(Room, {
      foreignKey: "room_id",
      as: "room",
      onDelete: "CASCADE",
    });
    RoomMember.belongsTo(Workspace, {
      foreignKey: "workspace_id",
      as: "workspace",
      onDelete: "CASCADE",
    });
    RoomMember.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    // The manager who approved or declined a join request. SET NULL, not
    // CASCADE: a decision outlives the person who made it.
    RoomMember.belongsTo(User, {
      foreignKey: "decided_by",
      as: "decider",
      onDelete: "SET NULL",
    });
    Room.hasMany(RoomMember, {
      foreignKey: "room_id",
      as: "roomMembers",
      onDelete: "CASCADE",
    });
    Workspace.hasMany(RoomMember, {
      foreignKey: "workspace_id",
      as: "roomMembers",
      onDelete: "CASCADE",
    });

    // Room <-> Task. Set when a task is created from a room board, so the room
    // page can ask for ITS tasks instead of deriving them from "tasks on this
    // project assigned to somebody in this room" — a derivation that
    // double-counts anyone sitting in two rooms of one project.
    Task.belongsTo(Room, {
      foreignKey: "room_id",
      as: "room",
      onDelete: "SET NULL",
    });
    Room.hasMany(Task, {
      foreignKey: "room_id",
      as: "tasks",
      onDelete: "SET NULL",
    });
    User.hasMany(RoomMember, {
      foreignKey: "user_id",
      as: "roomMemberships",
    });

    // Session-scoped unlocks. CASCADE both ways: an unlock is meaningless
    // without its workspace, and it must not outlive the user.
    WorkspaceUnlock.belongsTo(Workspace, {
      foreignKey: "workspace_id",
      as: "workspace",
      onDelete: "CASCADE",
    });
    WorkspaceUnlock.belongsTo(User, {
      foreignKey: "user_id",
      as: "user",
      onDelete: "CASCADE",
    });
    Workspace.hasMany(WorkspaceUnlock, {
      foreignKey: "workspace_id",
      as: "unlocks",
      onDelete: "CASCADE",
    });

  }

  static initModels(sequelize: Sequelize) {
    initDomain(sequelize);
    initProjectModel(sequelize);
    initUserModel(sequelize);
    initProjectMemberModel(sequelize);
    initDomainAssignmentModel(sequelize);
    initTaskGroupModel(sequelize);
    initTaskModel(sequelize);
    initDailyTaskLogModel(sequelize);
    initLeaveModel(sequelize);
    initLeaveBalanceModel(sequelize);
    initNotificationModel(sequelize);
    initAttendanceModel(sequelize);
    initWorkspaceModel(sequelize);
    initRoomModel(sequelize);
    initRoomMemberModel(sequelize);
    initWorkspaceUnlockModel(sequelize);
  }
}
