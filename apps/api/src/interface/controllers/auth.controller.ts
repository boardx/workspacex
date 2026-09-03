/**
 * Auth routes. Protocol adaptation only -- every judgement happens in `application`.
 *
 * ## Why all three are `@Public()`
 *
 * The Guard is registered globally and protection is the default, so these must opt out
 * explicitly: you cannot present a session in order to obtain one. `@Public()` is the
 * enumerated exemption, which is the right polarity -- the alternative (public by default,
 * annotate what needs protecting) makes one missed annotation a silent hole.
 *
 * ## Why every failure is the same status code
 *
 * `INVALID_CREDENTIAL`, `ACCOUNT_LOCKED` and `EMAIL_NOT_VERIFIED` all return 401 with the
 * reason in the BODY. Mapping them onto distinct statuses (403 for locked, 409 for
 * unverified) would put the distinction in a channel that survives every proxy, log and
 * metrics dashboard -- and I-1 is about "email not found" and "wrong password" being
 * indistinguishable, which they are here because they are the same code AND the same status
 * AND the same elapsed time.
 *
 * `AUTH_SERVICE_UNAVAILABLE` is deliberately NOT in that group: it carries no information
 * about which account was queried (it fires the same way for any email, existing or not, the
 * instant the session store is unreachable), so giving it its own 503 reopens nothing I-1
 * closes. Every other bundle in this codebase already treats it this way (`PrincipalGuard`'s
 * `auth_unavailable`, `project.controller.ts`'s per-operation 503 branch) -- this endpoint
 * was the one place that hadn't caught up, and a raw Redis error used to fall through
 * `toHttp()` untranslated into a bare `internal_error` 500 (2026-09-01, traceId
 * 28b6862c-71e1-4ce8-8e3f-3fceb9f8b607).
 */
import {
  Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards,
  ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { login } from "../../application/auth/login";
import {
  completePasswordReset,
  requestPasswordReset,
  type PasswordResetDeps,
} from "../../application/auth/password-reset";
import { inspectPasswordResetThrottle } from "../../application/auth/inspect-password-reset-throttle";
import { PlatformSuperuserGuard } from "../guards/platform-superuser.guard";
import { AuthError, PasswordPolicyError } from "../../application/auth/errors";
import {
  CLOCK, CREDENTIAL_REPOSITORY, LOGIN_ATTEMPT_REPOSITORY, MAILER, PASSWORD_HASHER,
  RESET_TOKEN_REPOSITORY, SESSION_TOKEN_STORE, TOKEN_FACTORY,
  type Clock, type CredentialRepository, type LoginAttemptRepository, type Mailer,
  type PasswordHasher, type ResetTokenRepository, type SessionTokenStore, type TokenFactory,
} from "../../application/auth/ports";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { ContractValidationError, ZodBodyPipe } from "../pipes/zod-body.pipe";
import { Public } from "../public.decorator";
import { deviceContextOf, type RequestLike } from "../device-context";

export const LOGIN_SCHEMA = C.operations.login.in;
export const RESET_REQUEST_SCHEMA = C.operations.requestPasswordReset.in;
export const RESET_COMPLETE_SCHEMA = C.operations.completePasswordReset.in;
export const INSPECT_THROTTLE_SCHEMA = C.operations.inspectPasswordResetThrottle.in;

type LoginBody = { email: string; password: string };
type ResetRequestBody = { email: string };
type ResetCompleteBody = { token: string; newPassword: string };
type InspectThrottleBody = { email: string };

@Controller()
export class AuthController {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_ATTEMPT_REPOSITORY) private readonly attempts: LoginAttemptRepository,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(RESET_TOKEN_REPOSITORY) private readonly resetTokens: ResetTokenRepository,
    @Inject(TOKEN_FACTORY) private readonly tokens: TokenFactory,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
  ) {}

  private get resetDeps(): PasswordResetDeps {
    return {
      credentials: this.credentials, hasher: this.hasher, resetTokens: this.resetTokens,
      sessions: this.sessions, tokens: this.tokens, mailer: this.mailer, clock: this.clock,
    };
  }

  /**
   * 200, not Nest's default 201 for POST. A session is established, but nothing is CREATED
   * at a URL the caller can go fetch -- and a client branching on 201 would treat login as
   * a resource-creating call.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("/auth/login")
  async login(
    // The pipe is on the PARAMETER, not the method. A method-level `@UsePipes` runs against
    // EVERY parameter, so the contract schema would also be applied to anything a custom
    // param decorator injects, fail, and 400 every request -- with a symptom that reads as
    // a malformed body and sends you to debug the client.
    @Body(new ZodBodyPipe(LOGIN_SCHEMA)) body: LoginBody,
    // F03：设备与登录地点。⚠ 从 `Request` 上读，**不从 body 读**——
    // 契约的 `login.in` 是 `.strict()` 的 `{email,password}`，而且客户端自报的设备名
    // 会被用户当成事实读。派生规则在 `domain/auth/device-fingerprint.ts`。
    @Req() req: RequestLike,
  ) {
    try {
      return await login(
        {
          credentials: this.credentials, hasher: this.hasher, attempts: this.attempts,
          sessions: this.sessions, tokens: this.tokens, clock: this.clock,
          identity: this.identity,
        },
        body,
        deviceContextOf(req),
      );
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * ⚠ ALWAYS `{ sent: true }`, and always 200.
   *
   * There is no failure branch in this handler, and there must not be one: an endpoint that
   * answers differently for a registered and an unregistered address is an unauthenticated
   * enumeration oracle. Anything that could distinguish them -- a status code, a thrown
   * error, a different body -- reopens it.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("/auth/password-reset/request")
  async requestReset(@Body(new ZodBodyPipe(RESET_REQUEST_SCHEMA)) body: ResetRequestBody) {
    return requestPasswordReset(this.resetDeps, body);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("/auth/password-reset/complete")
  async completeReset(@Body(new ZodBodyPipe(RESET_COMPLETE_SCHEMA)) body: ResetCompleteBody) {
    try {
      return await completePasswordReset(this.resetDeps, body);
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * 平台超管专用只读诊断（issue #2632）——见用例头注：不是 `@Public()`，走全局
   * `PrincipalGuard` 认证之后再叠 `PlatformSuperuserGuard`，与「系统异常 → 测试邮件」
   * 同一道门。
   */
  @UseGuards(PlatformSuperuserGuard)
  @HttpCode(HttpStatus.OK)
  @Post("/auth/password-reset/inspect-throttle")
  async inspectThrottle(@Body(new ZodBodyPipe(INSPECT_THROTTLE_SCHEMA)) body: InspectThrottleBody) {
    return inspectPasswordResetThrottle(
      { credentials: this.credentials, resetTokens: this.resetTokens, clock: this.clock },
      body,
    );
  }
}

/**
 * Map application errors onto HTTP.
 *
 * ⚠ `lockedUntil` is deliberately NOT put in the body. "Try again in 12 minutes" confirms
 * the account exists, which reopens on the ACCOUNT_LOCKED path the enumeration channel that
 * I-1 closes on the INVALID_CREDENTIAL path. The copy the UI shows is a fixed
 * "too many attempts, try again in {AUTH_POLICY.lockDurationMinutes} minutes", rendered
 * from the contract constant rather than from a server-supplied deadline.
 *
 * Anything that is not an `AuthError` or a `PasswordPolicyError` is re-thrown untouched, so
 * `AllExceptionsFilter` turns it into `internal_error`. Catching broadly here would convert
 * a database outage into a 401, i.e. into "your password is wrong".
 */
function toHttp(e: unknown): unknown {
  if (e instanceof AuthError) {
    // `AUTH_SERVICE_UNAVAILABLE` is the one reason NOT in the "same status for all" group
    // (see the file header) -- it says nothing about which account was queried, so a
    // distinct 503 does not reopen the enumeration channel I-1 closes for the other three.
    if (e.reason === "AUTH_SERVICE_UNAVAILABLE") {
      return new ServiceUnavailableException({ reasonCode: e.reason });
    }
    // The reason code travels in the body, the status is the same for all of them.
    return new UnauthorizedException({ reasonCode: e.reason });
  }
  if (e instanceof PasswordPolicyError) {
    // A field-level 400, the same shape `ZodBodyPipe` produces for a contract violation --
    // because that is what it is: the value is invalid, not the caller.
    return new ContractValidationError([{ path: "newPassword", code: e.rejection }]);
  }
  return e;
}
