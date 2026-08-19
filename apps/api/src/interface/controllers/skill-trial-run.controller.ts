/**
 * `POST /skill-versions/:versionId/trial-run` —— 契约 `skills.operations.runTrialRun`
 * `GET  /skill-trial-runs/:trialRunId`       —— 契约 `skills.operations.getTrialRun`
 *
 * 独立文件，理由与 `agent-trial-run.controller.ts` 头注一致：不改 `skill.controller.ts`。
 * 判断全部在 application 层（`submit-trial-run.ts` / `execute-trial-run.ts`）——
 * 本文件只做 HTTP 边界：鉴权异常翻译、契约 `.parse()`。
 *
 * ## ⚠ F962：POST 从「同步返回结果」改成「返回 asyncTaskId」
 *
 * 这是本 delta 最大的契约面改动，签核逐字批准过（`confirmed_via`：「接受试跑转异步
 * （会改试跑 API 形状）」）。`out.asyncTaskId` 这个槽位从契约第一版就在，只是此前恒为
 * `null`；现在反过来：**`trialRun` 恒为 `null`，`asyncTaskId` 恒非 null**。
 *
 * 理由是 R9 的硬线，不是偏好：实测单次真实模型调用 33.5s～300s，叠加 §7 最多 3 次
 * 回喂重试与沙箱执行 ⇒ 必然远超「超 10 秒转后台任务」。
 *
 * ⚠ 没有保留「小任务仍走同步」的分支。那种折中要求提交端点先猜这次会不会慢，
 *   而它猜不到（同一个 skill 第一次失败、第二次才收敛是常态），猜错就是超时。
 *
 * ## 洋葱约束
 *
 * 本文件**不 import 任何 `infrastructure/`**（`lint-arch-deps` 机械门控 + F962 的 V5
 * 专属断言）。沙箱、存储、执行器全部按应用层端口注入。
 */
import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { skills as C } from "@repo/contracts";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { toOrgId } from "../../domain/org-id";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";
import { IDENTITY_REPOSITORY, type IdentityRepository } from "../../application/identity/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { TrialRunSkillError } from "../../application/skill/trial-run-skill";
import { readTrialRun, submitTrialRun } from "../../application/skill/submit-trial-run";
import {
  SKILL_TRIAL_RUN_EXECUTOR,
  SKILL_TRIAL_RUN_STORE,
  type SkillTrialRunExecutorPort,
  type SkillTrialRunStore,
  type TrialRunRow,
} from "../../application/skill/trial-run-async-ports";

type TrialRunSkillBody = { readonly versionId: string; readonly sampleInput: string };

/** 静态兜底模型配置的 DI 令牌（沿用既有名字，`kernel.module.ts` 已在提供）。 */
export const SKILL_TRIALRUN_MODEL_ID = Symbol("SkillTrialRunModelId");

@Controller()
export class SkillTrialRunController {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly identities: IdentityRepository,
    @Inject(SKILL_TRIAL_RUN_STORE) private readonly store: SkillTrialRunStore,
    @Inject(SKILL_TRIAL_RUN_EXECUTOR) private readonly executor: SkillTrialRunExecutorPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
  };

  @Post(C.operations.runTrialRun.path)
  async trialRun(
    @CurrentPrincipal() principal: Principal,
    @Param("versionId") versionId: string,
    @Body(new ZodBodyPipe(C.operations.runTrialRun.in)) body: TrialRunSkillBody,
  ) {
    assertPrincipal(principal);
    // Path is authoritative, same discipline as `agent-trial-run.controller.ts`.
    void body.versionId;
    try {
      const { asyncTaskId } = await submitTrialRun(
        { identities: this.identities, store: this.store, executor: this.executor },
        {
          orgId: toOrgId(principal.orgId),
          actorId: principal.userId,
          versionId,
          sampleInput: body.sampleInput,
        },
      );
      // ⚠ `trialRun` 恒为 null —— 结果只从 `getTrialRun` 轮询取，见文件头。
      return C.operations.runTrialRun.out.parse({ trialRun: null, asyncTaskId });
    } catch (e) {
      if (e instanceof TrialRunSkillError) {
        this.log("skill trial run submit failed", { versionId, detail: e.code });
        throw new ServiceUnavailableException({ reasonCode: e.code });
      }
      throw e;
    }
  }

  /**
   * 轮询读。
   *
   * ⚠ 读不到 → **裸 404，没有 body**。不存在 / 别人的 / 别的组织的三者在这里
   *   刻意不可区分：区分它们就是一个存在性预言机（同 `agent-run.controller.ts`）。
   */
  @Get(C.operations.getTrialRun.path)
  async getTrialRun(
    @CurrentPrincipal() principal: Principal,
    @Param("trialRunId") trialRunId: string,
  ) {
    assertPrincipal(principal);
    const row = await readTrialRun(
      { store: this.store },
      { orgId: toOrgId(principal.orgId), actorId: principal.userId, trialRunId },
    );
    if (row === null) throw new NotFoundException();
    return C.operations.getTrialRun.out.parse(toResponse(row));
  }
}

/**
 * 行 → 契约响应。
 *
 * ⚠ `trialRun` 与 `failure` **互斥**：成功才有前者，失败才有后者，非终态两者皆 null。
 *   不做「失败时也回一个字段全空的 trialRun」——那会让调用方无法用"有没有 trialRun"
 *   判断成败，只能去猜字段。
 */
function toResponse(row: TrialRunRow) {
  if (row.status === "succeeded") {
    return {
      trialRunId: row.id,
      status: row.status,
      trialRun: {
        trialRunId: row.id,
        versionId: row.versionId,
        input: row.sampleInput,
        output: row.output ?? "",
        durationMs: row.durationMs ?? 0,
        tokens: row.tokens ?? 0,
        hitDataScope: [],
        artifacts: row.artifacts,
        attempts: row.attempts,
      },
      failure: null,
    };
  }
  if (row.status === "failed") {
    return {
      trialRunId: row.id,
      status: row.status,
      trialRun: null,
      failure: {
        code: row.failureCode ?? "DEPENDENCY_UNAVAILABLE",
        // ⚠ 原文，不加工（#660）。前端要友好文案自己按 code 渲染，
        //   但**必须**同时能看到这段真实 stderr。
        stderr: row.failureStderr ?? "",
        attempts: row.attempts,
      },
    };
  }
  return { trialRunId: row.id, status: row.status, trialRun: null, failure: null };
}
