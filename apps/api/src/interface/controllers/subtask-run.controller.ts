/**
 * `POST /internal/subtask-runs` —— issue #2664 步骤 4：deep-agent-service 的
 * `spawn_async_task` 工具通过这个端点把子任务信息写入 TS 侧队列
 * （`apps/api/src/application/agent-run/subtask-run-queue.ts`）。
 *
 * `GET /agent-runs/:runId/subtask-runs` —— issue #2666 新增：前端后台任务面板轮询这个
 * 端点，拿某个父 run 下全部子任务 run 的当前状态。见该方法自己的文档。
 *
 * ## 为什么入队端点是 `@Public()` + 共享密钥，不是 `PrincipalGuard`
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
 * ## orgId 从请求体来，不从 principal 派生（入队端点）
 *
 * 没有 principal 可派生 orgId——`parentRunId` 所属的 org 由调用方（deep-agent-service）
 * 在 `configurable` 里原样转发给它（TS 侧建 run 时塞进去的那个 orgId，见
 * `deep-agent-model-provider.ts`），这里只是把它当作一个不透明字符串接住、透传给
 * `SubtaskRunStore`——不做"这个 orgId 是否真的拥有 parentRunId"这类校验（子任务队列
 * 是内部机制，不是面向租户的公开 API，真实的租户隔离仍由 `parentRunId` 对应的主 run
 * 本身的可见性规则保证）。
 *
 * ## GET 端点的鉴权与已知简化（issue #2666 范围内的取舍）
 *
 * 这条路由**要求登录**（`CurrentPrincipal`），按 `principal.orgId` 过滤子任务 run——
 * 与 `agent-run.controller.ts` 的 `GET /agent-runs/:runId` 不同，这里**没有**再调用
 * `readAgentRun`/`resolveVisibility` 去确认这个 `runId` 是否真的是该用户可见的那个
 * 主 run（那条判定链路依赖 Chat 的完整可见性图，接进来会显著超出 #2666"最小可行查询
 * 接口"的范围）。已知边界：同组织内知道其他人 run id 的用户能读到该 run 的子任务状态
 * ——比 `GET /agent-runs/:runId` 本身的租户隔离粒度粗一档，不是逐 run 级。留作后续
 * 与 #2664/#2666 之外的鉴权收紧任务处理，本 PR 描述里同样注明这一点。
 */
import {
  BadRequestException, Body, Controller, Get, Headers, Inject, NotFoundException, Param, Post,
  UnauthorizedException,
} from "@nestjs/common";
import { Public } from "../public.decorator";
import { CurrentPrincipal } from "../current-principal.decorator";
import { assertPrincipal, type Principal } from "../../domain/principal";
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

  /**
   * issue #2666 —— 前端后台任务面板轮询这个端点。`main` 分支此时没有 WebSocket/SSE
   * 推送通路可接（读过 #2664 对应 PR #2675 的完整 diff 确认：deep-agent-service 只有
   * 内部 `POST /internal/subtask-runs` 回调，没有任何面向浏览器的查询/订阅接口）——
   * 轮询是本 issue 明确允许的最小可行实现，取舍在本 PR 描述与本文件头注里说明。
   */
  @Get("/agent-runs/:runId/subtask-runs")
  async listByParentRun(
    @CurrentPrincipal() principal: Principal,
    @Param("runId") runId: string,
  ): Promise<SubtaskRunContract.ListSubtaskRunsResult> {
    assertPrincipal(principal);
    const subtaskRuns = await this.store.listByParentRun(toOrgId(principal.orgId), runId);
    return { parentRunId: runId, subtaskRuns: [...subtaskRuns] };
  }

  /**
   * issue #2666 验收标准第三条「提供重试这一个的入口」——**简化实现**（issue 原文明确
   * 允许）：重新入队一条 `description`/`context` 与失败那条一致的新子任务 run，是
   * "再排一次队"，不是"让原来那条复活"（原条目的终态 `failed` 不变，`id` 也不同）。
   * 没有做的部分：幂等去重（连点两下会入队两条）、"新条目替换旧条目在面板里的位置"
   * 这类 UX 打磨——本 PR 描述里同样注明这是简化实现。
   */
  @Post("/agent-runs/:runId/subtask-runs/:id/retry")
  async retry(
    @CurrentPrincipal() principal: Principal,
    @Param("runId") runId: string,
    @Param("id") id: string,
  ) {
    assertPrincipal(principal);
    const orgId = toOrgId(principal.orgId);
    const existing = await this.store.get(orgId, id);
    if (!existing || existing.parentRunId !== runId) throw new NotFoundException();
    const run = await this.store.enqueue(orgId, {
      parentRunId: existing.parentRunId,
      description: existing.description,
      context: existing.context,
    });
    return { subtaskRunId: run.id, status: run.status };
  }
}
