/**
 * `system-error-logs` 契约束的两条路由。
 *
 * ## 为什么是独立 controller
 *
 * 两条路由服务两件不同的事——"平台超管读诊断表" 与 "前端匿名上报一次异常"——
 * 唯一的共同点是都落在同一张 `error_logs` 表。挂到 `FeedbackController` 或任何
 * 已有 controller 上都会让那个 controller 背上一份与自己主语无关的依赖
 * （`ERROR_LOG_PORT`）。
 *
 * ## `GET /system/error-logs`：鉴权在 Guard 层，不在这里
 *
 * 见 `@repo/contracts` 的 `system-error-logs.ts` 文件头：`error_logs` 没有
 * `org_id`，按组织角色开放会让任意一个组织的管理员看到全平台的异常详情。
 * 判定"这个 principal 是不是平台运营准入（平台超管或平台管理员）"这件事本身，按
 * `.agents/skills/mod-org-identity/SKILL.md` 的规定，属于
 * `apps/api/src/interface/guards`（全站鉴权的唯一权威落点），不属于业务
 * controller——见 `PlatformOperatorGuard`（review finding，PR #2475：第一版
 * 曾把这段判定直接写在这个 controller 里，是本仓明令禁止的"另起一套"；
 * platform-admin-role delta，2026-09-03，把原来的 `PlatformSuperuserGuard` 换成
 * 组合门 `PlatformOperatorGuard`——落库的平台管理员也该能读系统异常，见该 guard 头注）。
 *
 * ## `POST /system/client-error-reports`：为什么 `@Public()` + 限流 Guard
 *
 * 见同一文件头："未登录时的白屏"正是最值得被看见的一类前端异常，要求鉴权上报
 * 会让这类异常永远进不了这张表。写入永远返回 200——哪怕底层写库失败，调用方
 * （前端错误边界）也不应该因为"上报本身失败"而多出一条要处理的错误分支。
 * 但一个免鉴权的写口不能没有请求量上界（review finding，PR #2475）——见
 * `ClientErrorReportRateLimitGuard`。
 */
import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { systemErrorLogs as C } from "@repo/contracts";
import { ERROR_LOG_PORT, type ErrorLogPort } from "../../application/ports/error-log.port";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import {
  SystemErrorConcurrentUpdateError,
  SystemErrorIllegalTransitionError,
  SystemErrorNotFoundError,
  SystemErrorReasonRequiredError,
  SystemErrorReasonRequiresStatusError,
  updateSystemErrorLifecycle,
} from "../../application/system/update-system-error-lifecycle";
import { CurrentPrincipal } from "../current-principal.decorator";
import { Public } from "../public.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { traceIdOf } from "../middleware/trace";
import { PlatformOperatorGuard } from "../guards/platform-operator.guard";
import { ClientErrorReportRateLimitGuard } from "../guards/client-error-report-rate-limit.guard";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";

export const REPORT_CLIENT_ERROR_SCHEMA = C.operations.reportClientError.in;
export const UPDATE_SYSTEM_ERROR_LIFECYCLE_SCHEMA = C.operations.updateSystemErrorLifecycle.in;

type ReportClientErrorBody = ReturnType<typeof C.operations.reportClientError.in.parse>;
type UpdateSystemErrorLifecycleBody = ReturnType<typeof C.operations.updateSystemErrorLifecycle.in.parse>;

@Controller()
export class SystemErrorLogController {
  constructor(
    @Inject(ERROR_LOG_PORT) private readonly errorLog: ErrorLogPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  @UseGuards(PlatformOperatorGuard)
  @Get("/system/error-logs")
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query("limit") limitParam: string | undefined,
    @Query("beforeId") beforeId: string | undefined,
  ) {
    // `PlatformSuperuserGuard` has already run by the time this body executes -- this is
    // only the same structural non-null assertion every other controller in this codebase
    // makes, not a second authorization decision.
    assertPrincipal(principal);

    const parsedLimit = limitParam === undefined ? undefined : Number(limitParam);
    const limit =
      parsedLimit !== undefined && Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200
        ? parsedLimit
        : 50;
    return this.errorLog.list({ limit, beforeId: beforeId ?? null });
  }

  @UseGuards(PlatformOperatorGuard)
  @Put("/system/error-logs/:id")
  async updateLifecycle(
    @CurrentPrincipal() principal: Principal,
    @Param("id") id: string,
    @Body(new ZodBodyPipe(UPDATE_SYSTEM_ERROR_LIFECYCLE_SCHEMA)) body: UpdateSystemErrorLifecycleBody,
  ) {
    assertPrincipal(principal);
    try {
      return await updateSystemErrorLifecycle(this.errorLog, {
        id,
        status: body.status,
        statusReason: body.statusReason,
        devNote: body.devNote,
        tags: body.tags,
      });
    } catch (e) {
      if (e instanceof SystemErrorNotFoundError) throw new NotFoundException({ reasonCode: "NOT_FOUND" });
      if (e instanceof SystemErrorReasonRequiredError) {
        throw new UnprocessableEntityException({ reasonCode: "REASON_REQUIRED" });
      }
      if (e instanceof SystemErrorIllegalTransitionError) {
        throw new UnprocessableEntityException({ reasonCode: "INVALID_TRANSITION", from: e.from, to: e.to });
      }
      if (e instanceof SystemErrorReasonRequiresStatusError) {
        throw new UnprocessableEntityException({ reasonCode: "REASON_REQUIRES_STATUS" });
      }
      if (e instanceof SystemErrorConcurrentUpdateError) {
        // 409：不是"下游依赖不可用"，是"这条系统异常的状态被别的请求同时改过"——
        // 语义上是并发冲突，重试前应该先刷新看看结果，而不是无脑重试。
        throw new ConflictException({ reasonCode: "CONCURRENT_UPDATE" });
      }
      throw e;
    }
  }

  @Public()
  @UseGuards(ClientErrorReportRateLimitGuard)
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
