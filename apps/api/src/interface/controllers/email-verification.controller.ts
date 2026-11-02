import { UnauthorizedException, BadRequestException, Body, Controller, ServiceUnavailableException, Inject, Post, Req, Res } from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { CREDENTIAL_REPOSITORY, PASSWORD_HASHER, LOGIN_ATTEMPT_REPOSITORY, type CredentialRepository, type PasswordHasher, type LoginAttemptRepository, CLOCK, SESSION_TOKEN_STORE, TOKEN_FACTORY, type SessionTokenStore, type TokenFactory, type Clock } from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_TOKEN_CODEC,
  type EmailVerificationRepository,
  type EmailVerificationTokenCodec,
} from "../../application/auth/email-verification-ports";
import { confirmEmailVerification, resendEmailVerification, resendVerificationWithPassword } from "../../application/auth/email-verification";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { issueAuthenticatedSession } from "../../application/auth/issue-authenticated-session";
import { AuthError } from "../../application/auth/errors";
import { deviceContextOf, type RequestLike } from "../device-context";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { pendingVerificationSetCookie, readPendingVerificationCookie } from "../pending-verification-cookie";

@Controller()
export class EmailVerificationController {
  constructor(
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private readonly repo: EmailVerificationRepository,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly tokens: EmailVerificationTokenCodec,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(TOKEN_FACTORY) private readonly sessionTokens: TokenFactory,
    @Inject(IDENTITY_REPOSITORY) private readonly identity: IdentityRepository,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_ATTEMPT_REPOSITORY) private readonly attempts: LoginAttemptRepository,
  ) {}

  @Public()
  @Post("/auth/email-verifications/confirm")
  async confirm(
    @Body(new ZodBodyPipe(C.operations.confirmEmailVerification.in)) body: { token: string; autoStartSession?: boolean },
    @Req() request: RequestLike & { headers: { cookie?: string } },
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const result = await confirmEmailVerification({
      token: body.token, now: this.clock.now(), repo: this.repo, tokens: this.tokens,
      pendingIdentityProof: body.autoStartSession === true
        ? readPendingVerificationCookie(request.headers.cookie) : null,
    });
    if (result.outcome === "invalid") {
      throw new BadRequestException({ reasonCode: "VERIFICATION_LINK_INVALID" });
    }
    if (result.sessionUserId) {
      try {
        const session = await issueAuthenticatedSession({
          identity: this.identity, sessions: this.sessions, tokens: this.sessionTokens,
        }, result.sessionUserId, this.clock.now(), deviceContextOf(request));
        response.setHeader("Set-Cookie", pendingVerificationSetCookie("", process.env.NODE_ENV === "production", 0));
        return { status: "completed" as const, session };
      } catch (error) {
        if (error instanceof AuthError && error.reason === "AUTH_SERVICE_UNAVAILABLE") {
          throw new ServiceUnavailableException({ reasonCode: error.reason });
        }
        throw error;
      }
    }
    return { status: "completed" as const };
  }

  @Public()
  @Post("/auth/email-verifications/resend")
  async resend(
    @Body(new ZodBodyPipe(C.operations.resendEmailVerification.in)) body: { email: string; password?: string },
    @Req() request: { headers: { cookie?: string } },
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    const recover = async (password: string) => {
      try {
        return await resendVerificationWithPassword({
          credentials: this.credentials, hasher: this.hasher, attempts: this.attempts,
          clock: this.clock, repo: this.repo, tokens: this.tokens,
        }, { email: body.email, password });
      } catch (error) {
        if (error instanceof AuthError) throw new UnauthorizedException({ reasonCode: error.reason });
        throw error;
      }
    };
    const result = body.password !== undefined
      ? await recover(body.password)
      : await resendEmailVerification({
      email: body.email,
      pendingIdentityProof: readPendingVerificationCookie(request.headers.cookie),
      now: this.clock.now(), repo: this.repo, tokens: this.tokens,
    });
    if (result.pendingIdentityProof) {
      response.setHeader("Set-Cookie", pendingVerificationSetCookie(
        result.pendingIdentityProof,
        process.env.NODE_ENV === "production",
      ));
    }
    return { verificationDelivery: result.verificationDelivery };
  }
}
