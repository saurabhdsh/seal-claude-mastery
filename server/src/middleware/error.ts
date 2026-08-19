import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(new HttpError(400, "Validation failed", "VALIDATION", parsed.error.flatten()));
    }
    (req as Request & { [k: string]: unknown })[source] = parsed.data;
    next();
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }
  logger.error("unhandled", { err: err instanceof Error ? err.stack : err, path: req.path });
  res.status(500).json({ error: "Internal server error", code: "INTERNAL" });
}
