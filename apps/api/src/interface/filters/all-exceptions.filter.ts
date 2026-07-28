/**
 * Error boundary -- one of the three mandatory runtime gates in `architecture.md`.
 *
 * Contract: the response body carries only an error code and a traceId; detail goes to
 * the log. `err.message` routinely contains SQL fragments, table names and connection
 * strings, none of which may reach the response body.
 *
 * But returning only `internal_error` is not enough either: that would make production
 * issues undiagnosable, trading security for unoperability. Hence the mandatory traceId,
 * with the full detail available in the log under the same id (I-11).
 *
 * Error codes come from a CLOSED mapping off the status code, never from the exception
 * message -- using messages as codes turns internal strings into a public contract.
 */
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import type { Response } from "express";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { ContractValidationError } from "../pipes/zod-body.pipe";
import { traceIdOf } from "../middleware/trace";

/** status code -> public error code. Closed set: additions go through review. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
  503: "dependency_unavailable",
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const traceId = traceIdOf(http.getRequest());

    if (exception instanceof ContractValidationError) {
      // Field-level errors are PART OF THE CONTRACT, not internal detail:
      // a path plus a zod code, never the submitted value.
      this.logger.error("contract validation failed", { traceId, err: exception });
      res.status(HttpStatus.BAD_REQUEST).json({
        error: "validation_failed",
        traceId,
        fields: exception.fields,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.logger.error("http exception", { traceId, err: exception, status });
      res.status(status).json({ error: CODE_BY_STATUS[status] ?? "internal_error", traceId });
      return;
    }

    this.logger.error("unhandled exception", { traceId, err: exception });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal_error", traceId });
  }
}
