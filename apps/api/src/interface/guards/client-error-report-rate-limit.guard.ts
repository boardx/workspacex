/**
 * Rate limit for `POST /system/client-error-reports` -- the one `@Public()` write route this
 * bundle adds (review finding, PR #2475: an anonymous write path with no request-volume
 * bound is an open flood/storage-pressure surface). See `domain/system/rate-limit.ts` and
 * `infrastructure/system/in-memory-rate-limiter.ts` for the decision function and its
 * documented limits (single-process, best-effort).
 *
 * ## Why a guard, not a check inside the controller
 *
 * Same reasoning as `PlatformSuperuserGuard`: this repository's authorization/abuse-control
 * decisions live in `interface/guards`, not scattered per-controller.
 *
 * ## Keyed by `req.ip`
 *
 * There is no session/email identity available on this route (it is reachable before
 * login, by design) -- IP is the only dimension that exists to key on. See
 * `domain/system/rate-limit.ts`'s file header for why that is an acceptable trade-off here,
 * unlike login lockout's deliberate email-not-IP choice.
 */
import { CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { RATE_LIMITER_PORT, type RateLimiterPort } from "../../application/ports/rate-limiter.port";

@Injectable()
export class ClientErrorReportRateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER_PORT) private readonly limiter: RateLimiterPort) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = req.ip ?? "unknown";
    const verdict = await this.limiter.hit(`client-error-report:${key}`);
    if (!verdict.allowed) {
      throw new HttpException(
        { reasonCode: "RATE_LIMITED", retryAfterMs: verdict.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
