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
import { artifact, identity } from "@repo/contracts";
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

/**
 * The ONE piece of exception detail allowed into a response body: `reasonCode`.
 *
 * This looks like the thing the file's header forbids, so here is the distinction. The ban
 * is on using exception MESSAGES as codes -- arbitrary internal strings becoming a public
 * contract by accident. `PermissionReason` is the opposite: a closed enum in
 * `@repo/contracts` that the frontend already renders against, and it is parsed against
 * that enum here, so nothing outside it can pass through no matter what an exception
 * carries.
 *
 * It has to be here because UC-0.3 R8 requires a denial to say WHICH LAYER refused --
 * "org-level restriction: this resource is limited to the energy team" versus "you have no
 * role in this project". Four different problems rendered as one bare 403 send the user
 * hunting for a permission that was never the issue.
 */
function permissionReasonOf(exception: HttpException): { reasonCode?: string } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const parsed = identity.PermissionReason.safeParse((body as { reasonCode?: unknown }).reasonCode);
  return parsed.success ? { reasonCode: parsed.data } : {};
}

/**
 * The SECOND and last piece of exception detail allowed through: an `ArtifactError` code and
 * the artifact it is about (F07 / E1).
 *
 * Same shape of exemption as `permissionReasonOf`, and it needs the same justification.
 * `REQUIRES_PINNED` is not an internal string: it is a member of a closed enum in
 * `@repo/contracts`, it is parsed against that enum here, and nothing outside it passes no
 * matter what an exception carries. `artifactId` is parsed as a plain non-empty string and
 * is only ever the PARENT of a version the caller just addressed successfully -- it
 * discloses no resource the caller could not already name.
 *
 * It has to be here because AC1's refusal is required to be actionable: uc-0-1 E1 says the
 * denial must offer 一键定版, and an interface that receives `{"error":"conflict"}` has
 * nothing to offer it with. That is the difference between a gate and a dead end -- and a
 * dead end is what users route around by copying the content somewhere the gate is not.
 */
function artifactErrorOf(exception: HttpException): { artifactError?: string; artifactId?: string } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const raw = body as { artifactError?: unknown; artifactId?: unknown };
  const code = artifact.ArtifactError.safeParse(raw.artifactError);
  if (!code.success) return {};
  const id = typeof raw.artifactId === "string" && raw.artifactId.length > 0 ? raw.artifactId : undefined;
  return id === undefined ? { artifactError: code.data } : { artifactError: code.data, artifactId: id };
}

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
      res.status(status).json({
        error: CODE_BY_STATUS[status] ?? "internal_error",
        traceId,
        ...permissionReasonOf(exception),
        ...artifactErrorOf(exception),
      });
      return;
    }

    this.logger.error("unhandled exception", { traceId, err: exception });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal_error", traceId });
  }
}
