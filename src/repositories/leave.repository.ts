import { Leave } from "../connection/models/leave";
import { LeaveBalance } from "../connection/models/leave_balance";
import { User } from "../connection/models/user";
import { NotificationRepository } from "./notification.repository";
import { Op, literal } from "sequelize";

const notificationRepo = new NotificationRepository();

export class LeaveRepository {
  // Calculate business days (exclude weekends)
  private calculateBusinessDays(startDate: string, endDate: string, session: string): number {
    if (session === "First Half" || session === "Second Half") {
      return 0.5;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  }

  public async applyLeave(data: {
    user_id: string;
    leave_type: string;
    session: string;
    start_date: string;
    end_date: string;
    reason: string;
    contact?: string;
  }) {
    try {
      const user = await User.findByPk(data.user_id, {
        attributes: ["id", "manager_id", "role", "fullName"],
      });
      if (!user) throw new Error("User not found");

      const isAM = user.role === "AM";
      const manager_id = user.manager_id || null;
      const total_days = this.calculateBusinessDays(data.start_date, data.end_date, data.session);

      // AM leaves skip the manager step and wait directly on SP — but the visible
      // status is still "pending" until SP acts. SP-side query scopes by applicant role.
      const status = "pending";

      const leave = await Leave.create({
        user_id: data.user_id,
        manager_id: isAM ? null : manager_id,
        leave_type: data.leave_type,
        session: data.session,
        start_date: data.start_date,
        end_date: data.end_date,
        total_days,
        reason: data.reason,
        contact: data.contact || null,
        status,
        applied_at: new Date(),
      });

      if (isAM) {
        // Notify all SP users directly
        const spUsers = await User.findAll({ where: { role: "SP" }, attributes: ["id"] });
        for (const sp of spUsers) {
          await notificationRepo.create({
            user_id: sp.id,
            type: "leave_pending_admin",
            title: "Leave Pending Your Approval",
            message: `${user.fullName || "An AM"} has applied for ${data.leave_type} (${data.start_date} to ${data.end_date}). Awaiting your approval.`,
            reference_id: leave.id,
          });
        }
      } else if (manager_id) {
        // Notify the AM (manager)
        await notificationRepo.create({
          user_id: manager_id,
          type: "leave_applied",
          title: "New Leave Request",
          message: `${user.fullName || "A team member"} has applied for ${data.leave_type} (${data.start_date} to ${data.end_date})`,
          reference_id: leave.id,
        });
      }

      return leave;
    } catch (error) {
      throw error;
    }
  }

  public async getMyLeaves(
    user_id: string,
    status?: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const where: any = { user_id };
      if (status) where.status = status;

      const offset = (page - 1) * limit;
      const { count, rows } = await Leave.findAndCountAll({
        where,
        include: [
          { model: User, as: "manager", attributes: ["id", "fullName"] },
          { model: User, as: "admin", attributes: ["id", "fullName"] },
        ],
        order: [["applied_at", "DESC"]],
        offset,
        limit,
      });
      console.log("getMyLeaves:", { user_id, status, count, rows });
      return {
        data: rows,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  public async getLeaveBalance(user_id: string) {
    try {
      const currentYear = new Date().getFullYear();
      let balances = await LeaveBalance.findAll({
        where: { user_id, year: currentYear },
        raw: true,
      });

      // If no balance records exist, create default ones
      if (balances.length === 0) {
        const defaultLeaveTypes = [
          { leave_type: "Casual Leave", total: 8 },
          { leave_type: "Sick Leave", total: 6 },
          { leave_type: "Earned Leave", total: 12 },
        ];
        for (const lt of defaultLeaveTypes) {
          await LeaveBalance.create({
            user_id,
            leave_type: lt.leave_type,
            total: lt.total,
            used: 0,
            remaining: lt.total,
            year: currentYear,
          });
        }
        balances = await LeaveBalance.findAll({
          where: { user_id, year: currentYear },
          raw: true,
        });
      }

      return balances;
    } catch (error) {
      throw error;
    }
  }

  public async getPendingForManager(
    manager_id: string,
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const offset = (page - 1) * limit;
      const { count, rows } = await Leave.findAndCountAll({
        where: { manager_id, status: "pending" },
        include: [
          { model: User, as: "applicant", attributes: ["id", "fullName", "email", "employee_id", "department"] },
        ],
        order: [["applied_at", "DESC"]],
        offset,
        limit,
      });

      console.log("getPendingForManager:", { manager_id, count, rows });
      return {
        data: rows,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  public async managerAction(
    leave_id: string,
    manager_id: string,
    action: "approve" | "reject",
    remarks?: string
  ) {
    try {
      const leave = await Leave.findByPk(leave_id);
      if (!leave) throw new Error("Leave not found");
      if (leave.manager_id !== manager_id)
        throw new Error("Not authorized to act on this leave");
      if (leave.status !== "pending")
        throw new Error("Leave is not in pending status");

      // Check if applicant is USER/DEVLOPER — AM approval is final for them
      const applicant = await User.findByPk(leave.user_id, { attributes: ["id", "fullName", "role"] });
      const isRegularUser = applicant?.role === "USER" || applicant?.role === "DEVLOPER";

      const manager = await User.findByPk(manager_id, { attributes: ["fullName"] });
      const managerName = manager?.fullName || "Your manager";

      if (action === "approve") {
        if (isRegularUser) {
          // AM approval is final for USER/DEVLOPER — directly approved
          leave.status = "approved";
          leave.manager_remarks = remarks || null;
          leave.manager_action_at = new Date();
          leave.updated_at = new Date();
          await leave.save();

          // Deduct from leave balance
          const currentYear = new Date().getFullYear();
          const balance = await LeaveBalance.findOne({
            where: {
              user_id: leave.user_id,
              leave_type: leave.leave_type,
              year: currentYear,
            },
          });
          if (balance) {
            const totalDays = Number(leave.total_days);
            balance.used = balance.used + totalDays;
            balance.remaining = balance.remaining - totalDays;
            await balance.save();
          }

          await notificationRepo.create({
            user_id: leave.user_id,
            type: "leave_approved",
            title: "Leave Approved",
            message: `${managerName} has approved your ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}).`,
            reference_id: leave.id,
          });
        } else {
          // AM applied leave — needs SP approval
          leave.status = "manager_approved";
          leave.manager_remarks = remarks || null;
          leave.manager_action_at = new Date();
          leave.updated_at = new Date();
          await leave.save();

          await notificationRepo.create({
            user_id: leave.user_id,
            type: "leave_manager_approved",
            title: "Leave Approved by Manager",
            message: `${managerName} has approved your ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}). Pending admin approval.`,
            reference_id: leave.id,
          });

          // Notify all SP users
          const spUsers = await User.findAll({ where: { role: "SP" }, attributes: ["id"] });
          for (const sp of spUsers) {
            await notificationRepo.create({
              user_id: sp.id,
              type: "leave_pending_admin",
              title: "Leave Pending Your Approval",
              message: `${applicant?.fullName || "A user"}'s ${leave.leave_type} has been approved by ${managerName}. Awaiting your final approval.`,
              reference_id: leave.id,
            });
          }
        }
      } else {
        leave.status = "manager_rejected";
        leave.manager_remarks = remarks || null;
        leave.manager_action_at = new Date();
        leave.updated_at = new Date();
        await leave.save();

        await notificationRepo.create({
          user_id: leave.user_id,
          type: "leave_manager_rejected",
          title: "Leave Rejected by Manager",
          message: `${managerName} has rejected your ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}).${remarks ? " Remarks: " + remarks : ""}`,
          reference_id: leave.id,
        });
      }

      return leave;
    } catch (error) {
      throw error;
    }
  }

  public async getPendingForAdmin(page: number = 1, limit: number = 10) {
    try {
      const offset = (page - 1) * limit;
      const { count, rows } = await Leave.findAndCountAll({
        where: { status: { [Op.in]: ["pending", "manager_approved"] } },
        include: [
          {
            model: User,
            as: "applicant",
            attributes: ["id", "fullName", "email", "employee_id", "department", "role"],
            where: { role: "AM" },
          },
          { model: User, as: "manager", attributes: ["id", "fullName"] },
        ],
        order: [["applied_at", "DESC"]],
        offset,
        limit,
      });

      console.log("getPendingForAdmin:", { count, rows });
      return {
        data: rows,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  public async adminAction(
    leave_id: string,
    admin_id: string,
    action: "approve" | "reject",
    remarks?: string
  ) {
    try {
      const leave = await Leave.findByPk(leave_id);
      if (!leave) throw new Error("Leave not found");

      const applicant = await User.findByPk(leave.user_id, {
        attributes: ["id", "fullName", "role"],
      });

      // Allowed: "manager_approved" (legacy/AM-applied), or "pending" only for AM applicants.
      const isAmApplicant = applicant?.role === "AM";
      const isPendingAm = leave.status === "pending" && isAmApplicant;
      if (
        leave.status !== "manager_approved" &&
        !isPendingAm
      ) {
        throw new Error("Leave is not awaiting admin approval");
      }

      const admin = await User.findByPk(admin_id, { attributes: ["fullName"] });
      const adminName = admin?.fullName || "Admin";

      if (action === "approve") {
        leave.status = "approved";
        leave.admin_id = admin_id;
        leave.admin_remarks = remarks || null;
        leave.admin_action_at = new Date();
        leave.updated_at = new Date();
        await leave.save();

        // Deduct from leave balance
        const currentYear = new Date().getFullYear();
        const balance = await LeaveBalance.findOne({
          where: {
            user_id: leave.user_id,
            leave_type: leave.leave_type,
            year: currentYear,
          },
        });

        if (balance) {
          const totalDays = Number(leave.total_days);
          balance.used = balance.used + totalDays;
          balance.remaining = balance.remaining - totalDays;
          await balance.save();
        }

        // Notify applicant
        await notificationRepo.create({
          user_id: leave.user_id,
          type: "leave_approved",
          title: "Leave Approved",
          message: `Your ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}) has been approved by ${adminName}.`,
          reference_id: leave.id,
        });
      } else {
        leave.status = "rejected";
        leave.admin_id = admin_id;
        leave.admin_remarks = remarks || null;
        leave.admin_action_at = new Date();
        leave.updated_at = new Date();
        await leave.save();

        // Notify applicant
        await notificationRepo.create({
          user_id: leave.user_id,
          type: "leave_rejected",
          title: "Leave Rejected",
          message: `Your ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}) has been rejected by ${adminName}.${remarks ? " Remarks: " + remarks : ""}`,
          reference_id: leave.id,
        });
      }

      return leave;
    } catch (error) {
      throw error;
    }
  }

  public async getTeamLeavesForManager(
    manager_id: string,
    filters: {
      status?: string;
      leave_type?: string;
      user_id?: string;
      from_date?: string;
      to_date?: string;
    },
    page: number = 1,
    limit: number = 10
  ) {
    try {
      const teamIds = await this.getTeamUserIds(manager_id);
      if (teamIds.length === 0) {
        return { data: [], total: 0, page, limit };
      }

      const where = this.buildTeamLeavesWhere(teamIds, filters);
      const offset = (page - 1) * limit;

      const { count, rows } = await Leave.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: "applicant",
            attributes: ["id", "fullName", "email", "employee_id", "department", "role"],
          },
        ],
        order: [["applied_at", "DESC"]],
        offset,
        limit,
      });

      return {
        data: rows,
        total: count,
        page,
        limit,
      };
    } catch (error) {
      throw error;
    }
  }

  public async getTeamLeavesForExport(
    manager_id: string,
    filters: {
      status?: string;
      leave_type?: string;
      user_id?: string;
      from_date?: string;
      to_date?: string;
    }
  ) {
    try {
      const teamIds = await this.getTeamUserIds(manager_id);
      if (teamIds.length === 0) return [];

      const where = this.buildTeamLeavesWhere(teamIds, filters);

      const rows = await Leave.findAll({
        where,
        include: [
          {
            model: User,
            as: "applicant",
            attributes: ["id", "fullName", "email", "employee_id", "department", "role"],
          },
        ],
        order: [["applied_at", "DESC"]],
      });

      return rows;
    } catch (error) {
      throw error;
    }
  }

  private async getTeamUserIds(manager_id: string): Promise<string[]> {
    const team = await User.findAll({
      where: { manager_id, role: { [Op.in]: ["USER", "DEVLOPER"] } },
      attributes: ["id"],
      raw: true,
    });
    return team.map((u: any) => u.id);
  }

  private buildTeamLeavesWhere(
    teamIds: string[],
    filters: {
      status?: string;
      leave_type?: string;
      user_id?: string;
      from_date?: string;
      to_date?: string;
    }
  ): any {
    const where: any = { user_id: { [Op.in]: teamIds } };

    if (filters.user_id) {
      if (!teamIds.includes(filters.user_id)) {
        where.user_id = "__no_match__";
      } else {
        where.user_id = filters.user_id;
      }
    }
    if (filters.status) where.status = filters.status;
    if (filters.leave_type) where.leave_type = filters.leave_type;
    if (filters.from_date && filters.to_date) {
      where.start_date = { [Op.lte]: filters.to_date };
      where.end_date = { [Op.gte]: filters.from_date };
    } else if (filters.from_date) {
      where.end_date = { [Op.gte]: filters.from_date };
    } else if (filters.to_date) {
      where.start_date = { [Op.lte]: filters.to_date };
    }

    return where;
  }

  public async cancelLeave(leave_id: string, user_id: string) {
    try {
      const leave = await Leave.findByPk(leave_id);
      if (!leave) throw new Error("Leave not found");
      if (leave.user_id !== user_id)
        throw new Error("Not authorized to cancel this leave");
      if (leave.status !== "pending")
        throw new Error("Only pending leaves can be cancelled");

      leave.status = "cancelled";
      leave.updated_at = new Date();
      await leave.save();

      // Notify the manager about cancellation
      if (leave.manager_id) {
        const applicant = await User.findByPk(user_id, { attributes: ["fullName"] });
        await notificationRepo.create({
          user_id: leave.manager_id,
          type: "leave_cancelled",
          title: "Leave Cancelled",
          message: `${applicant?.fullName || "A team member"} has cancelled their ${leave.leave_type} request (${leave.start_date} to ${leave.end_date}).`,
          reference_id: leave.id,
        });
      }

      return leave;
    } catch (error) {
      throw error;
    }
  }
}
