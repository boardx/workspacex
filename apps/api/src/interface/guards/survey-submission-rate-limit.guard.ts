import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import {
  RATE_LIMITER_PORT,
  type RateLimiterPort,
} from "../../application/ports/rate-limiter.port";
/** Same existing best-effort per-IP limiter as the other anonymous write surface. */
@Injectable()
export class SurveySubmissionRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER_PORT) private readonly limiter: RateLimiterPort,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const verdict = await this.limiter.hit(
      `survey-submission:${req.ip ?? "unknown"}`,
    );
    if (!verdict.allowed)
      throw new HttpException(
        { reasonCode: "RATE_LIMITED", retryAfterMs: verdict.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
