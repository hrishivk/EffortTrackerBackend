import { DailyTaskLog, initDailyTaskLogModel } from "../models/daily_task_logs";
import initDomain, { Domain } from "../models/domain";
import initProjectModel, { Project } from "../models/project";
import initProjectMemberModel, { ProjectMember } from "../models/project_member";
import { initTaskModel, Task } from "../models/tasks";
import initUserModel, { User } from "../models/user";
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
  }

  static initModels(sequelize: Sequelize) {
    initDomain(sequelize);
    initProjectModel(sequelize);
    initUserModel(sequelize);
    initProjectMemberModel(sequelize);
    initTaskModel(sequelize);
    initDailyTaskLogModel(sequelize);
  }
}
