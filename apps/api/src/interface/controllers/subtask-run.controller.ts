/**
 * `POST /internal/subtask-runs` —— issue #2664 步骤 4：deep-agent-service 的
 * `spawn_async_task` 工具通过这个端点把子任务信息写入 TS 侧队列
 * （`apps/api/src/application/agent-run/subtask-run-queue.ts`）。
 *
 * ## 为什么是 `@Public()` + 共享密钥，不是 `PrincipalGuard`
 *
 * 调用方是 `apps/deep-agent-service` 进程本身，不是某个已登录用户——这次请求没有
 * 用户会话可解析，`PrincipalGuard` 的"principal 必须非空"语义在这里没有对应物。
 * 与 `system-error-log.controller.ts` 的 `POST /system/client-error-reports`
 * 同一先例（未登录调用方 + `@Public()`），区别在那里限的是速率，这里限的是"必须持有
 * 这把共享密钥"——`DEEP_AGENT_SERVICE_INTERNAL_KEY` 未设时端点整体拒绝所有请求
 * （fail closed，不是"没配就放行"）。密钥由部署期配置，与
 * `apps/deep-agent-service` 侧读取的同一个值必须一致（见
 * `deep-agent-model-provider.ts` 传给 Python 侧 `configurable.subtask_callback` 的
 * 同一个值，单一事实源在环境变量本身，两侧都读它，不在代码里各写一份）。
 *
 * ## orgId 从请求体来，不从 principal 派生
 *
 * 没有 principal 可派生 orgId——`parentRunId` 所属的 org 由调用方（deep-agent-service）
 * 在 `configurable` 里原样转发给它（TS 侧建 run 时塞进去的那个 orgId，见
 * `deep-agent-model-provider.ts`），这里只是把它当作一个不透明字符串接住、透传给
 * `SubtaskRunStore`——不做"这个 orgId 是否真的拥有 parentRunId"这类校验（子任务队列
 * 是内部机制，不是面向租户的公开 API，真实的租户隔离仍由 `parentRunId` 对应的主 run
 * 本身的可见性规则保证）。
 */
import {
  BadRequestException, Body, Controller, Headers, Inject, Post, UnauthorizedException,
} from "@nestjs/common";
import { Public } from "../public.decorator";
import { toOrgId } from "../../domain/org-id";
import { subtaskRun as SubtaskRunContract } from "@repo/contracts";
import { SUBTASK_RUN_STORE, type SubtaskRunStore } from "../../application/agent-run/subtask-run-queue";

const INTERNAL_KEY_HEADER = "x-deep-agent-internal-key";

@Controller()
export class SubtaskRunController {
  constructor(@Inject(SUBTASK_RUN_STORE) private readonly store: SubtaskRunStore) {}

  @Public()
  @Post("/internal/subtask-runs")
  async enqueue(
    @Headers(INTERNAL_KEY_HEADER) providedKey: string | undefined,
    @Body() body: unknown,
  ) {
    const expectedKey = (process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? "").trim();
    // 没配密钥 ⇒ 端点整体拒绝——与本文件头注"fail closed，不是没配就放行"一致，
    // 未设置该环境变量的部署里 `spawn_async_task` 应当保持它的默认关闭态
    // （见 harness.py `build_subagents`/`spawn_async_task` 同一条灰度纪律）。
    if (expectedKey === "" || providedKey !== expectedKey) {
      throw new UnauthorizedException("subtask_callback_unauthorized");
    }
    const orgIdRaw = (body as { orgId?: unknown } | null)?.orgId;
    if (typeof orgIdRaw !== "string" || orgIdRaw.trim() === "") {
      throw new BadRequestException("orgId is required");
    }
    const parsed = SubtaskRunContract.EnqueueSubtaskRunInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const run = await this.store.enqueue(toOrgId(orgIdRaw), parsed.data);
    return { subtaskRunId: run.id, status: run.status };
  }
}
