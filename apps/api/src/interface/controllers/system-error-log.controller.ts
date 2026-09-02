/**
 * `system-error-logs` 契约束的两条路由。
 *
 * ## 为什么是独立 controller
 *
 * 两条路由服务两件不同的事——"平台超管读诊断表" 与 "前端匿名上报一次异常"——
 * 唯一的共同点是都落在同一张 `error_logs` 表。挂到 `FeedbackController` 或任何
 * 已有 controller 上都会让那个 controller 背上一份与自己主语无关的依赖
 * （`ERROR_LOG_PORT` / `CREDENTIAL_REPOSITORY`）。
 *
 * ## `GET /system/error-logs`：为什么鉴权判定不是 `orgRole`
 *
 * 见 `@repo/contracts` 的 `system-error-logs.ts` 文件头：`error_logs` 没有
 * `org_id`，按组织角色开放会让任意一个组织的管理员看到全平台的异常详情。这里判
 * 定的是一个与组织完全无关的"平台超管"身份——`principal.userId` → 邮箱
 * （`CredentialRepository.findByUserId`）→ 命中 `PLATFORM_SUPERUSER_EMAILS`
 * 环境变量白名单才放行，否则 403 `NOT_PLATFORM_SUPERUSER`。
 *
 * ## `POST /system/client-error-reports`：为什么 `@Public()`
 *
 * 见同一文件头："未登录时的白屏"正是最值得被看见的一类前端异常，要求鉴权上报
 * 会让这类异常永远进不了这张表。写入永远返回 200——哪怕底层写库失败，调用方
 * （前端错误边界）也不应该因为"上报本身失败"而多出一条要处理的错误分支。
 */
import { Body, Controller, ForbiddenException, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { systemErrorLogs as C } from "@repo/contracts";
import { randomUUID } from "node:crypto";
import { ERROR_LOG_PORT, type ErrorLogPort } from "../../application/ports/error-log.port";
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from "../../application/auth/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { isPlatformSuperuserEmail, platformSuperuserWhitelistFromEnv } from "../../domain/system/platform-superuser";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { traceIdOf } from "../middleware/trace";

export const REPORT_CLIENT_ERROR_SCHEMA = C.operations.reportClientError.in;

type ReportClientErrorBody = ReturnType<typeof C.operations.reportClientError.in.parse>;

@Controller()
export class SystemErrorLogController {
  constructor(
    @Inject(ERROR_LOG_PORT) private readonly errorLog: ErrorLogPort,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  @Get("/system/error-logs")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("limit") limitParam: string | undefined,
    @Query("beforeId") beforeId: string | undefined,
  ) {
    assertPrincipal(principal);
    await this.assertPlatformSuperuser(principal);

    const parsedLimit = limitParam === undefined ? undefined : Number(limitParam);
    const limit =
      parsedLimit !== undefined && Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200
        ? parsedLimit
        : 50;
    return this.errorLog.list({ limit, beforeId: beforeId ?? null });
  }

  /**
   * ⚠ 邮箱查不到（principal 携带的 userId 在凭据表里没有对应行——理论上不该发生，
   *   见 `CredentialRepository.findByUserId` 的注释）时按未命中白名单处理，而不是
   *   抛一个 500：读不到诊断表不该比"没有这个诊断表"更糟。
   */
  private async assertPlatformSuperuser(principal: Principal): Promise<void> {
    const credential = await this.credentials.findByUserId(principal.userId);
    const whitelist = platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS);
    const email = credential?.email ?? "";
    if (!isPlatformSuperuserEmail(email, whitelist)) {
      throw new ForbiddenException({ reasonCode: "NOT_PLATFORM_SUPERUSER" });
    }
  }

  @Public()
  @Post("/system/client-error-reports")
  async report(
    @Req() req: unknown,
    @Body(new ZodBodyPipe(REPORT_CLIENT_ERROR_SCHEMA)) body: ReportClientErrorBody,
  ): Promise<{ traceId: string }> {
    const traceId = traceIdOf(req);
    // ⚠ Fire-and-forget，与 `AllExceptionsFilter` 的"unhandled exception"分支同一纪律：
    //   一个匿名上报口绝不能因为写库失败而让调用方（前端错误边界）多出一条要处理的错误。
    void this.errorLog
      .record({
        traceId,
        msg: `client error: ${body.message.slice(0, 200)}`,
        detail: {
          message: body.message,
          stack: body.stack ?? undefined,
          url: body.url ?? undefined,
          userAgent: body.userAgent ?? undefined,
          appVersion: body.appVersion ?? undefined,
        },
      })
      .catch((err) => this.logger.error("client error report: record failed", { traceId, err }));
    return { traceId };
  }
}
