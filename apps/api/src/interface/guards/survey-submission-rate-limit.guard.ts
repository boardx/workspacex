import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  RATE_LIMITER_PORT,
  type RateLimiterPort,
} from "../../application/ports/rate-limiter.port";
/** Survey-specific peer budget. The documented local Nginx ingress overwrites
 * X-Real-IP (packages/cloud-deploy/src/nginx.ts). Only trust that header from
 * loopback peers; remote peers and caller-supplied X-Forwarded-For never count.
 * Other ingress topologies must supply an explicitly reviewed trust boundary.
 */
@Injectable()
export class SurveySubmissionRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER_PORT) private readonly limiter: RateLimiterPort,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const peer = req.socket?.remoteAddress ?? req.ip ?? "unknown";
    const localIngress = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
    const realIp = req.headers?.["x-real-ip"];
    const respondent = localIngress && typeof realIp === "string" && isIP(realIp)
      ? realIp : peer;
    const publication = createHash("sha256").update(String(req.params?.token ?? "unknown")).digest("hex");
    const verdict = await this.limiter.hit(`survey-submission:${publication}:${respondent}`);
    if (!verdict.allowed)
      throw new HttpException(
        { reasonCode: "RATE_LIMITED", retryAfterMs: verdict.retryAfterMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
