import { LeaveRepository } from "../repositories/leave.repository";

const leaveRepository = new LeaveRepository();

export class LeaveService {
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
      return await leaveRepository.applyLeave(data);
    } catch (error) {
      throw error;
    }
  }

  public async getMyLeaves(user_id: string, status?: string, page?: number, limit?: number) {
    try {
      return await leaveRepository.getMyLeaves(user_id, status, page, limit);
    } catch (error) {
      throw error;
    }
  }

  public async getLeaveBalance(user_id: string) {
    try {
      return await leaveRepository.getLeaveBalance(user_id);
    } catch (error) {
      throw error;
    }
  }

  public async getPendingForManager(manager_id: string, page?: number, limit?: number) {
    try {
      return await leaveRepository.getPendingForManager(manager_id, page, limit);
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
      return await leaveRepository.managerAction(leave_id, manager_id, action, remarks);
    } catch (error) {
      throw error;
    }
  }

  public async getPendingForAdmin(page?: number, limit?: number) {
    try {
      return await leaveRepository.getPendingForAdmin(page, limit);
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
      return await leaveRepository.adminAction(leave_id, admin_id, action, remarks);
    } catch (error) {
      throw error;
    }
  }

  public async cancelLeave(leave_id: string, user_id: string) {
    try {
      return await leaveRepository.cancelLeave(leave_id, user_id);
    } catch (error) {
      throw error;
    }
  }
}
