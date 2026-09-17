import { Request, Response } from "express";
import HTTP_statusCode from "../Enums/statuCode";
import { sendResponse } from "../utils/sendResponse";
import reportService, {
  ReportAccessError,
  ReportNotFoundError,
} from "../service/report.service";
import { DateRangeError, parseDateRange } from "../utils/dateRange";


const reportErrorCode = (error: unknown): HTTP_statusCode => {
  if (error instanceof DateRangeError) return HTTP_statusCode.BadRequest;
  if (error instanceof ReportAccessError) return HTTP_statusCode.NoAccess;
  if (error instanceof ReportNotFoundError) return HTTP_statusCode.NotFound;
  return HTTP_statusCode.InternalServerError;
};

const fail = (res: Response, error: any, fallback: string) => {
  const code = reportErrorCode(error);
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


const includes = (value: unknown, member: string): boolean =>
  String(value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(member);

export class ReportController {
  public async userReport(req: Request, res: Response): Promise<void> {
    try {
      const viewer = req.user;
      if (!viewer?.id) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }
      const user_id = optional(req.query.user_id) ?? viewer.id;
      const range = parseDateRange(req.query.from, req.query.to);

      const data = await reportService.userReport({
        viewer: { id: viewer.id, role: viewer.role },
        user_id,
        range,
        project_id: optional(req.query.project_id),
        group_id: optional(req.query.group_id),
        include_tasks: includes(req.query.include, "tasks"),
      });

      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Report generated successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Failed to generate the report");
    }
  }

  public async teamReport(req: Request, res: Response): Promise<void> {
    try {
      const viewer = req.user;
      if (!viewer?.id) {
        sendResponse(res, HTTP_statusCode.unAuthorized, {
          success: false,
          message: "Unauthorized: user not found in token",
        });
        return;
      }

      const range = parseDateRange(req.query.from, req.query.to);
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit as string) || 20, 1),
        100
      );

      const data = await reportService.teamReport({
        viewer: { id: viewer.id, role: viewer.role },
        range,
        project_id: optional(req.query.project_id),
        group_id: optional(req.query.group_id),
        department_id: optional(req.query.department_id),
        page,
        limit,
      });

      sendResponse(res, HTTP_statusCode.OK, {
        success: true,
        message: "Report generated successfully",
        data,
      });
    } catch (error: any) {
      fail(res, error, "Failed to generate the report");
    }
  }
}
