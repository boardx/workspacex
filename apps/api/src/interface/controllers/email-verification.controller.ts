import { BadRequestException, Body, Controller, Inject, Post } from "@nestjs/common";
import { auth as C } from "@repo/contracts";
import { CLOCK, type Clock } from "../../application/auth/ports";
import {
  EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_TOKEN_CODEC,
  type EmailVerificationRepository,
  type EmailVerificationTokenCodec,
} from "../../application/auth/email-verification-ports";
import { confirmEmailVerification, resendEmailVerification } from "../../application/auth/email-verification";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

@Controller()
export class EmailVerificationController {
  constructor(
    @Inject(EMAIL_VERIFICATION_REPOSITORY) private readonly repo: EmailVerificationRepository,
    @Inject(EMAIL_VERIFICATION_TOKEN_CODEC) private readonly tokens: EmailVerificationTokenCodec,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Public()
  @Post("/auth/email-verifications/confirm")
  async confirm(@Body(new ZodBodyPipe(C.operations.confirmEmailVerification.in)) body: { token: string }) {
    const result = await confirmEmailVerification({
      token: body.token, now: this.clock.now(), repo: this.repo, tokens: this.tokens,
    });
    if (result.outcome === "invalid") {
      throw new BadRequestException({ reasonCode: "VERIFICATION_LINK_INVALID" });
    }
    return { status: "completed" as const };
  }

  @Public()
  @Post("/auth/email-verifications/resend")
  resend(@Body(new ZodBodyPipe(C.operations.resendEmailVerification.in)) body: { email: string }) {
    return resendEmailVerification({
      email: body.email, now: this.clock.now(), repo: this.repo, tokens: this.tokens,
    });
  }
}
