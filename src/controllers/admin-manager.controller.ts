import { Request, Response, NextFunction } from "express";
import ExcelJS from "exceljs";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import { adminMangerService } from "../service/admin-manger.service";
import { LeaveService } from "../service/leave.service";

const SuperAdminService = new adminMangerService();
const leaveService = new LeaveService();

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending Manager",
  manager_approved: "Pending Admin",
  manager_rejected: "Rejected by Manager",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function readLeaveFilters(req: Request) {
  return {
    status: (req.query.status as string),
    leave_type: (req.query.leave_type as string),
    user_id: (req.query.user_id as string),
    from_date: (req.query.from_date as string),
    to_date: (req.query.to_date as string),
  };
}

function formatDate(value: any): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatDateTime(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export class managerController {
  public async listAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const managerId = req.user?.id;
      if (!managerId) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const data = await SuperAdminService.getAllUsers(managerId);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Fetched successful",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.unAuthorized, {
        success: false,
        message: error.message || "Fetching failed",
      });
    }
  }

  public async getTeamLeaves(req: Request, res: Response): Promise<void> {
    try {
      const managerId = req.user?.id;
      if (!managerId) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const filters = readLeaveFilters(req);
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const result = await leaveService.getTeamLeaves(managerId, filters, page, limit);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Team leaves fetched successfully",
        data: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch team leaves",
      });
    }
  }

  public async exportTeamLeaves(req: Request, res: Response): Promise<void> {
    try {
      const managerId = req.user?.id;
      if (!managerId) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const filters = readLeaveFilters(req);
      const rows = await leaveService.getTeamLeavesForExport(managerId, filters);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Team Leaves");
      sheet.columns = [
        { header: "Employee Name", key: "employeeName", width: 25 },
        { header: "Employee ID", key: "employeeId", width: 15 },
        { header: "Email", key: "email", width: 28 },
        { header: "Department", key: "department", width: 18 },
        { header: "Role", key: "role", width: 12 },
        { header: "Leave Type", key: "leaveType", width: 18 },
        { header: "Session", key: "session", width: 14 },
        { header: "From", key: "from", width: 14 },
        { header: "To", key: "to", width: 14 },
        { header: "Total Days", key: "totalDays", width: 12 },
        { header: "Reason", key: "reason", width: 40 },
        { header: "Status", key: "status", width: 20 },
        { header: "Manager Remarks", key: "managerRemarks", width: 30 },
        { header: "Admin Remarks", key: "adminRemarks", width: 30 },
        { header: "Applied On", key: "appliedAt", width: 20 },
        { header: "Manager Action On", key: "managerActionAt", width: 20 },
        { header: "Admin Action On", key: "adminActionAt", width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };

      for (const r of rows) {
        const plain: any = r.get({ plain: true });
        const a = plain.applicant || {};
        sheet.addRow({
          employeeName: a.fullName || "",
          employeeId: a.employee_id || "",
          email: a.email || "",
          department: a.department || "",
          role: a.role || "",
          leaveType: plain.leave_type || "",
          session: plain.session || "",
          from: formatDate(plain.start_date),
          to: formatDate(plain.end_date),
          totalDays: Number(plain.total_days) || 0,
          reason: plain.reason || "",
          status: STATUS_LABELS[plain.status] || plain.status || "",
          managerRemarks: plain.manager_remarks || "",
          adminRemarks: plain.admin_remarks || "",
          appliedAt: formatDateTime(plain.applied_at),
          managerActionAt: formatDateTime(plain.manager_action_at),
          adminActionAt: formatDateTime(plain.admin_action_at),
        });
      }

      const today = new Date().toISOString().split("T")[0];
      const filename = `team-leaves-${today}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        sendResponse(res, HTTP_statusCode.InternalServerError, {
          success: false,
          message: error.message || "Failed to export team leaves",
        });
      } else {
        res.end();
      }
    }
  }

  public async listTeamMembers(req: Request, res: Response): Promise<void> {
    try {
      const managerId = req.user?.id;
      if (!managerId) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const data = await SuperAdminService.getTeamMembersForFilter(managerId);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Team members fetched successfully",
        data,
      });
    } catch (error: any) {
      sendResponse(res, HTTP_statusCode.InternalServerError, {
        success: false,
        message: error.message || "Failed to fetch team members",
      });
    }
  }
}
