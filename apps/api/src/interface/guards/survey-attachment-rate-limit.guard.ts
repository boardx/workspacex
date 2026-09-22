import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { RateLimiterPort } from "../../application/ports/rate-limiter.port";
export const SURVEY_ATTACHMENT_RATE_LIMITER = Symbol(
  "SurveyAttachmentRateLimiter",
);
// Fifty session files, each uploaded, previewed, and optionally removed, plus retries.
export const SURVEY_ATTACHMENT_REQUESTS_PER_MINUTE = 200;
@Injectable()
export class SurveyAttachmentRateLimitGuard implements CanActivate {
  constructor(
    @Inject(SURVEY_ATTACHMENT_RATE_LIMITER)
    private readonly limiter: RateLimiterPort,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<{ params: { token: string; sessionToken: string } }>();
    // Capability guard runs first. Shared office IPs do not consume one another's budget.
    const key = createHash("sha256")
      .update(JSON.stringify([req.params.token, req.params.sessionToken]))
      .digest("hex");
    const verdict = await this.limiter.hit(`survey-attachment:${key}`);
    if (!verdict.allowed)
      throw new HttpException(
        { reasonCode: "RATE_LIMITED", retryAfterMs: verdict.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
