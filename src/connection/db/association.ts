import { DailyTaskLog, initDailyTaskLogModel } from "../models/daily_task_logs";
import initDomain, { Domain } from "../models/domain";
import initProjectModel, { Project } from "../models/project";
import { initTaskModel, Task } from "../models/tasks";
import initUserModel, { User } from "../models/user";
import { Sequelize } from "sequelize";
export class Associations {
  static initialize() {
    console.log("connected the Association");
    User.belongsTo(Project, {
      foreignKey: "project_id",
      onDelete: "SET NULL",
    });
    Project.hasMany(User, {
      foreignKey: "project_id",
      onDelete: "CASCADE",
    });
    Project.belongsTo(Domain, {
      foreignKey: "domain_id",
      onDelete: "CASCADE",
    });
    Domain.hasMany(Project, {
      foreignKey: "domain_id",
      onDelete: "CASCADE",
    });
    Task.belongsTo(DailyTaskLog, {
      foreignKey: "daily_log_id",
      onDelete: "CASCADE",
    });
    DailyTaskLog.hasMany(Task, {
      foreignKey: "daily_log_id",
      onDelete: "CASCADE",
    });
    DailyTaskLog.belongsTo(User, {
      foreignKey: "user_id",
      onDelete: "CASCADE",
    });
    User.hasMany(DailyTaskLog, {
      foreignKey: "user_id",
      onDelete: "CASCADE",
    });
  }
  static initModels(sequelize: Sequelize) {
    initDomain(sequelize);
    initProjectModel(sequelize);
    initUserModel(sequelize);
    initTaskModel(sequelize);
    initDailyTaskLogModel(sequelize);
  }
}
