/**
 * `POST /auth/register` -- protocol adaptation only (F19 / UC-1.5).
 *
 * Every judgement is in `application`; this file turns a body into a call and an exception
 * into a status code.
 *
 * ## Why it is `@Public()`
 *
 * The whole point of registration is that the caller has no account yet. `PrincipalGuard` is
 * registered globally precisely so that "forgot to protect a route" is impossible, which
 * means opening one has to be an explicit, greppable act -- and this is the first route in
 * the kernel that needs it.
 *
 * ⚠ Public does NOT mean unauthenticated-and-therefore-unrestricted: the invite code IS the
 * authorization for this endpoint. That is the whole reason the product is invite-only
 * ("只能被邀请入组织") and the whole reason the code's failure mode is anti-enumeration
 * rather than helpful.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { registerWithInvite } from "../../application/auth/register-with-invite";
import { bootstrapFirstUser } from "../../application/auth/bootstrap-first-user";
import {
  BootstrapUnavailableError,
  EmailTakenError,
  InviteCodeInvalidError,
} from "../../application/auth/errors";
import {
  PASSWORD_HASHER,
  REGISTRATION_REPOSITORY,
  type PasswordHasher,
  type RegistrationRepository,
} from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_TOKEN_CODEC,
  type EmailVerificationTokenCodec,
} from "../../application/auth/email-verification-ports";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { pendingVerificationSetCookie } from "../pending-verification-cookie";

/** Exported so `contract-single-source.test.ts` can assert reference identity with the contract. */
export const REGISTER_SCHEMA = C.operations.redeemInviteAndCreateOrg.in;
export const BOOTSTRAP_SCHEMA = C.operations.bootstrapFirstUser.in;

type RegisterBody = {
  code: string;
  email: string;
  password: string;
  displayName: string;
  orgName: string;
};

type BootstrapBody = Omit<RegisterBody, "code">;

@Controller()
export class AuthRegistrationController {
  constructor(
    @Inject(REGISTRATION_REPOSITORY) private readonly repo: RegistrationRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly verificationTokens: EmailVerificationTokenCodec,
  ) {}

  @Public()
  @Post("/auth/bootstrap")
  async bootstrap(@Body(new ZodBodyPipe(BOOTSTRAP_SCHEMA)) body: BootstrapBody) {
    try {
      return await bootstrapFirstUser(
        { repo: this.repo, hasher: this.hasher },
        body,
      );
    } catch (e) {
      if (e instanceof BootstrapUnavailableError || e instanceof EmailTakenError) {
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }

  /**
   * 201 (Nest's default for POST) -- a resource really is created here, two of them.
   *
   * ## The two failures, and why their statuses differ
   *
   *   400 + `INVITE_CODE_INVALID`  the code is absent, spent, expired or revoked. **All
   *                                four produce this exact response**: same status, same
   *                                error code, same reasonCode, same body shape. Anything
   *                                that distinguished them would prune the 14-character
   *                                search space by hit rate (usecases.md).
   *   409 + `EMAIL_TAKEN`          the address already has an account. This one is
   *                                deliberately informative: UC-1.5 A2 requires the user be
   *                                told to sign in and use the code from there, and a vague
   *                                failure would strand them. Email enumeration is defended
   *                                at `Login` and `RequestPasswordReset`, which are F20's
   *                                and F21's.
   *
   * ⚠ The pipe is attached to the PARAMETER, not the method. A method-level `@UsePipes`
   * runs against EVERY parameter including custom decorators, so the contract schema would
   * be applied to things that are not the body and every request would 400 -- with a symptom
   * that reads as a malformed body and sends you to debug the client.
   */
  @Public()
  @Post("/auth/register")
  async register(
    @Body(new ZodBodyPipe(REGISTER_SCHEMA)) body: RegisterBody,
    @Res({ passthrough: true }) response: { setHeader(name: string, value: string): void },
  ) {
    try {
      const result = await registerWithInvite(
        { repo: this.repo, hasher: this.hasher, verificationTokens: this.verificationTokens },
        {
          code: body.code,
          email: body.email,
          password: body.password,
          displayName: body.displayName,
          orgName: body.orgName,
        },
      );
      response.setHeader("Set-Cookie", pendingVerificationSetCookie(
        result.pendingIdentityProof,
        process.env.NODE_ENV === "production",
      ));
      const { pendingIdentityProof: _proof, ...contractOutput } = result;
      return contractOutput;
    } catch (e) {
      // ⚠ Nothing from the exception reaches the response except `reasonCode`, which
      // `all-exceptions.filter.ts` re-parses against the closed `AuthReason` enum before
      // emitting. In particular the caught error is never stringified -- `lint-error-leak`
      // bans that in this layer, and here it would be a body containing SQL.
      if (e instanceof InviteCodeInvalidError) {
        throw new BadRequestException({ reasonCode: e.reasonCode });
      }
      if (e instanceof EmailTakenError) {
        throw new ConflictException({ reasonCode: e.reasonCode });
      }
      throw e;
    }
  }
}
