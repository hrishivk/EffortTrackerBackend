import { Response } from "express";
import HTTP_statusCode from "../Enums/statuCode";

export const sendResponse = (
  res: Response,
  statusCode: HTTP_statusCode,
  payload: any
) => {
  return res.status(statusCode).json(payload);
};
