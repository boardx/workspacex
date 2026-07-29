/**
 * traceId injection -- an Express middleware rather than a Nest interceptor.
 *
 * The reason is ordering: interceptors run AFTER guards. A request rejected by the guard
 * never reaches an interceptor, so its response would carry no traceId -- and the contract
 * "the response only says internal_error, look the detail up by traceId" (I-11) matters
 * most precisely on the failure paths. Middleware sits outermost, so every path has one.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const TRACE_HEADER = "x-trace-id";

export interface TracedRequest extends Request {
  traceId?: string;
}

export function traceMiddleware(req: TracedRequest, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.traceId = id;
  res.setHeader(TRACE_HEADER, id);
  next();
}

export function traceIdOf(req: unknown): string {
  const t = (req as TracedRequest | undefined)?.traceId;
  return typeof t === "string" ? t : "no-trace";
}
