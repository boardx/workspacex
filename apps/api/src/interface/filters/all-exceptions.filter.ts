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
import { auth, identity } from "@repo/contracts";
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
 *
 * ## Two enums, both closed (F19)
 *
 * `auth.AuthReason` joins `identity.PermissionReason` here because the auth bundle's
 * failures are the same kind of thing: a closed enum in `@repo/contracts` that the frontend
 * renders against. Without it an `INVITE_CODE_INVALID` would be silently DROPPED by the
 * parse below and the caller would receive a bare `bad_request` -- the registration wizard
 * could not tell an unusable invite code from a malformed request body, and nothing would
 * report the loss because dropping is this function's normal behaviour for anything it does
 * not recognise.
 *
 * ⚠ Tried in order, and the union is still CLOSED: a value outside both enums cannot pass,
 * no matter what an exception carries. Adding a third enum here should be a deliberate act;
 * adding a free string must never be one.
 */
function permissionReasonOf(exception: HttpException): { reasonCode?: string } {
  const body = exception.getResponse();
  if (typeof body !== "object" || body === null) return {};
  const raw = (body as { reasonCode?: unknown }).reasonCode;
  const permission = identity.PermissionReason.safeParse(raw);
  if (permission.success) return { reasonCode: permission.data };

  // F20/F21: `auth.AuthReason` passes for the same reason and under the same restriction.
  //
  // It is a closed enum in `@repo/contracts`, parsed against that enum here, so nothing
  // outside it reaches a response no matter what an exception carries. The frontend renders
  // against it directly (the login screen's error copy is per-code).
  //
  // ⚠ Two codes appear in BOTH enums (`AUTH_SERVICE_UNAVAILABLE`). That is not a
  // duplicated fact -- `identity`'s means "the authorization service is unreachable" and
  // `auth`'s means "the session store is unreachable", and both must reach the client as
  // "refuse", never as a degraded allow. Ordering matters only in that the first match wins,
  // and for that code the rendered result is identical either way.
  const authReason = auth.AuthReason.safeParse(raw);
  if (authReason.success) return { reasonCode: authReason.data };

  /**
   * F16: `identity.LocalOrgReason`, the third and last closed enum here.
   *
   * Same restriction, same reasoning -- a closed enum in `@repo/contracts`, parsed against
   * that enum, so nothing outside it reaches a response. It is separate from
   * `PermissionReason` because it answers a different question: `PermissionReason` says WHO
   * was refused and at which layer, while these say the local runtime is down, the endpoint
   * is off-machine, or this route only serves personal-local organizations. Rendering a
   * dependency failure as a permission denial sends the user to ask an administrator for
   * access they already have.
   *
   * ⚠ Note what does NOT pass: the startup hint. It is a contract CONSTANT
   * (`LOCAL_RUNTIME_STARTUP_HINT`) the frontend reads directly, so the server never carries
   * the sentence across the wire -- carrying it would be the same fact in two places, which
   * is the failure this project has had five times.
   */
  const localOrg = identity.LocalOrgReason.safeParse(raw);
  return localOrg.success ? { reasonCode: localOrg.data } : {};
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
      });
      return;
    }

    this.logger.error("unhandled exception", { traceId, err: exception });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "internal_error", traceId });
  }
}
