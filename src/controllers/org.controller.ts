import { Request, Response } from "express";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import orgService, {
  OrgAccessError,
  OrgNotFoundError,
  OrgValidationError,
  windowOrLastDays,
  windowOrToday,
} from "../service/org.service";
import { DateRangeError } from "../utils/dateRange";

// Shared with the existing endpoints that grew a ?domain_id= filter, so a bad
// department answers the same way everywhere. null for anything that is not
// one of these errors — the caller keeps its own fallback.
export const orgErrorCode = (error: unknown): HTTP_statusCode | null => {
  if (error instanceof DateRangeError) return HTTP_statusCode.BadRequest;
  if (error instanceof OrgValidationError) return HTTP_statusCode.BadRequest;
  if (error instanceof OrgAccessError) return HTTP_statusCode.NoAccess;
  if (error instanceof OrgNotFoundError) return HTTP_statusCode.NotFound;
  return null;
};

const fail = (res: Response, error: any, fallback: string) => {
  const code = orgErrorCode(error) ?? HTTP_statusCode.InternalServerError;
  if (code === HTTP_statusCode.InternalServerError) console.error(fallback, error);
  sendResponse(res, code, {
    success: false,
    message:
      code === HTTP_statusCode.InternalServerError
        ? fallback
        : error?.message || fallback,
  });
};

const optional = (value: unknown): string | undefined => {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length ? raw : undefined;
};

const pageOf = (value: unknown): number => Math.max(parseInt(value as string) || 1, 1);
const limitOf = (value: unknown, fallback = 20): number =>
  Math.min(Math.max(parseInt(value as string) || fallback, 1), 100);

const viewerOf = (req: Request) => ({ id: req.user?.id as string, role: req.user?.role });

export class OrgController {
  // GET /role-sp/org-tree?from=&to=
  public async orgTree(req: Request, res: Response): Promise<void> {
    try {
      const range = windowOrToday(req.query.from, req.query.to);
      const data = await orgService.orgTree(viewerOf(req), range);
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Org tree fetched successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Fetching the org tree failed");
    }
  }

  // GET /role-sp/department-overview?domain_id=&from=&to=
  public async departmentOverview(req: Request, res: Response): Promise<void> {
    try {
      const range = windowOrLastDays(req.query.from, req.query.to);
      const data = await orgService.departmentOverview(
        viewerOf(req),
        req.query.domain_id,
        range
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Department overview fetched successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Fetching the department overview failed");
    }
  }

  // GET /role-sp/department-members?domain_id=&from=&to=&search=&role=&page=&limit=&sort=
  public async departmentMembers(req: Request, res: Response): Promise<void> {
    try {
      const range = windowOrToday(req.query.from, req.query.to);
      const data = await orgService.departmentMembers(viewerOf(req), {
        domainId: req.query.domain_id,
        range,
        search: optional(req.query.search),
        role: optional(req.query.role),
        page: pageOf(req.query.page),
        limit: limitOf(req.query.limit),
        sort: optional(req.query.sort),
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Department members fetched successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Fetching department members failed");
    }
  }

  // GET /role-sp/department-tasks?domain_id=&from=&to=&status=&priority=&assigned_to=&project_id=&overdue=&page=&limit=
  public async departmentTasks(req: Request, res: Response): Promise<void> {
    try {
      const range = windowOrToday(req.query.from, req.query.to);
      const overdue = String(req.query.overdue ?? "").trim().toLowerCase();
      const data = await orgService.departmentTasks(viewerOf(req), {
        domainId: req.query.domain_id,
        range,
        status: optional(req.query.status),
        priority: optional(req.query.priority),
        assignedTo: optional(req.query.assigned_to),
        projectId: optional(req.query.project_id),
        overdue: overdue === "true" || overdue === "1",
        page: pageOf(req.query.page),
        limit: limitOf(req.query.limit),
      });
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Department tasks fetched successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Fetching department tasks failed");
    }
  }

  // GET /role-sp/employee-summary?user_id=&from=&to=
  public async employeeSummary(req: Request, res: Response): Promise<void> {
    try {
      const range = windowOrLastDays(req.query.from, req.query.to);
      const data = await orgService.employeeSummary(
        viewerOf(req),
        req.query.user_id,
        range
      );
      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Employee summary fetched successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Fetching the employee summary failed");
    }
  }
}
