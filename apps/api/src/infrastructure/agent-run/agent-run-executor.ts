/**
 * The executor as the process runs it (#414's model call, #413's Chat writeback).
 *
 * ## Why acceptance kicks it, instead of a timer scanning for work
 *
 * `agent_runs` has RLS FORCEd, so a cross-tenant scan would read zero rows and look like
 * an empty queue forever -- the exact trap `database.port.ts` warns about for
 * `withoutTenant`, and the reason `pg-ingestion-repository` has no unscoped claim either.
 * A tenant is therefore named by something that already knows it: the request that just
 * accepted a message. `tick` claims every queued run for that tenant, so a run stranded by
 * a process restart is picked up by the next message in the same tenant rather than
 * needing its own reaper. 2026-08-30: a `running` run stranded by a process dying MID-EXECUTION
 * (after the claim moved it out of `queued`, so the next claim can never see it again) is the
 * one state this paragraph used to leave uncovered -- `tick` now also calls
 * `reclaimStaleRunning` first, on the same "the next message in the same tenant" trigger, so it
 * is not a second reaper mechanism, just the same one closing its one remaining gap.
 * ⚠ 2026-08-30 续（devapp 真栈复现）——"下一条消息"这个触发条件本身留了一个洞：用户提交
 * 一条任务后只刷新页面、从不发第二条消息，永远等不到这里。`readAgentRun`（应用层
 * `read-run.ts`）现在也会在单条只读请求里调用同一个方法——两个触发点，同一份判定
 * （`DEFAULT_STALE_RUNNING_THRESHOLD_MS`）。See `AgentRunStore.reclaimStaleRunning`'s own
 * doc (`ports.ts`) for the full account.
 *
 * ## `kick` returns void on purpose
 *
 * The Chat write must not become slower, or fail, because a model provider is slow or
 * down: §2 says the response is `202` with `runStatus: "queued"` and never an inline
 * reply. So the kick is fire-and-forget, and every outcome -- including a defect in the
 * executor itself -- is already durable in the run row before anyone reads it.
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { LoggerPort } from "../../application/ports/logger.port";
import {
  DEFAULT_STALE_RUNNING_THRESHOLD_MS,
  type AgentRunClock, type AgentRunExecutorPort, type AgentRunStore, type ModelCallPort, type TokenUsageMeterPort,
} from "../../application/agent-run/ports";
import type { FileRetrievalPort } from "../../application/agent-run/file-retrieval";
import type { AgentRunContextSnapshotPort } from "../../application/agent-run/context-snapshot";
import type { ToolTraceContextPort } from "../../application/agent-run/tool-trace-context";
import type { CanvasTemplateGuidancePort } from "../../application/agent-run/canvas-template-guidance";
import type { RunImagePort } from "../../application/agent-run/run-image-input";
import type { SkillSandboxPort } from "../../application/skill/skill-sandbox-port";
import type { ObjectStore } from "../../application/artifact/ports";
import type { PlanLedgerRepository, PlanRunStatusReader } from "../../application/plan-control/ports";
import { executeQueuedRuns } from "../../application/agent-run/execute-run";
import { writeBackPendingRuns } from "../../application/agent-run/writeback";

export class AgentRunExecutor implements AgentRunExecutorPort {
  private readonly clock: AgentRunClock = {
    now: () => new Date().toISOString(),
    newStepId: () => randomUUID(),
  };

  constructor(
    private readonly runs: AgentRunStore,
    private readonly model: ModelCallPort,
    private readonly logger: LoggerPort,
    /**
     * Whether THIS process executes runs. A deployment that moves execution to a separate
     * worker sets it to 0 here; it is not a test switch, and nothing about the run's
     * durable state depends on it.
     */
    private readonly autostart: boolean,
    /**
     * F159 计量。可选参数而不是必填：既有的测试与非计费执行路径构造这个类时不必都改，
     * 而生产合成（`kernel.module.ts`）必定注入——「有没有计量」因此是合成期的一个明确
     * 选择，不是运行期的一个偶然。
     */
    private readonly usage?: TokenUsageMeterPort,
    /**
     * F155 L3 —— 文件式检索。可选，与 `usage` 同一条理由（见上）：既有构造点不必都改，
     * 生产合成必定注入。不注入 ⇒ 组装出的 history 与 F155 之前逐字节相同。
     */
    private readonly files?: FileRetrievalPort,
    /**
     * F157 —— 可审计上下文快照。可选，与 `usage`/`files` 同一条既有理由：既有构造点不必都改，
     * 生产合成必定注入。不注入 ⇒ 不写快照，其余行为逐字节不变。
     */
    private readonly contextSnapshots?: AgentRunContextSnapshotPort,
    /**
     * F190 —— 工具调用轨迹跨 run 回喂上下文。可选，与 `usage`/`files`/`contextSnapshots`
     * 同一条既有理由：既有构造点不必都改，生产合成必定注入。不注入 ⇒ 组装出的 history 与
     * F190 之前逐字节相同。
     */
    private readonly toolTrace?: ToolTraceContextPort,
    /**
     * issue #1493 —— 本组织已发布画布模板清单，读出来拼进 system prompt。可选，与
     * `usage`/`files`/`contextSnapshots`/`toolTrace` 同一条既有理由：既有构造点不必都改，
     * 生产合成必定注入。不注入 ⇒ system prompt 与本次改动之前逐字节相同。
     */
    private readonly canvasTemplates?: CanvasTemplateGuidancePort,
    /**
     * P2（#1561）—— 推理侧图像通道。可选，与 `usage`/`files`/`contextSnapshots`/`toolTrace`
     * 同一条既有理由：既有构造点不必都改，生产合成必定注入。不注入 ⇒ 与 P2 之前逐字节相同
     * （不取图、不改 userText），快照如实记 `not_configured` 而不是假装本轮没有图。
     */
    private readonly runImages?: RunImagePort,
    /**
     * #1624 —— chat 里模型写的脚本真的在沙箱里跑。可选，与上面每一个同一条既有理由：
     * 既有构造点不必都改，生产合成必定注入。**两者必须一起注入才生效**——不注入 ⇒
     * 沙箱一次都不被调用、system prompt 不多一段执行协议、写回不挂任何附件，
     * 与本次改动之前逐字节相同。
     */
    private readonly sandbox?: SkillSandboxPort,
    private readonly objects?: ObjectStore,
    /**
     * F975 (`plan-control` 契约束, UC-12 `deliverPlanToRun`)。可选，与上面每一个同一条
     * 既有理由：既有构造点不必都改，生产合成必定注入。不注入，或线程没有账本/账本为空
     * ⇒ system prompt 与 F975 之前逐字节相同。见 `execute-run.ts`
     * `ExecuteAgentRunDeps.planLedger` 的完整文档。
     */
    private readonly planLedger?: PlanLedgerRepository & PlanRunStatusReader,
    /**
     * 2026-08-30 —— `reclaimStaleRunning` 的"卡够久"阈值（见 `ports.ts` 该方法的完整
     * 取证）。可选，默认 `DEFAULT_STALE_RUNNING_THRESHOLD_MS`（20 分钟，与 `readAgentRun`
     * 那一路共享同一个值，唯一事实源在 `ports.ts`）：比 `DeepAgentModelProvider` 自己的
     * `KERNEL_DEEP_AGENT_TIMEOUT_MS`（默认 5 分钟）留足够余量，不会把一个健康进程里
     * 正常运行、只是恰好较慢的 run 误判成"卡住"——它自己的超时会先触发、被
     * `executeQueuedRuns` 的 catch 分支标记失败，根本轮不到这里。这个阈值只用来兜底
     * 进程本身消失、连自己的超时都没机会跑的那种情况。
     */
    private readonly staleRunningThresholdMs: number = DEFAULT_STALE_RUNNING_THRESHOLD_MS,
  ) {}

  /**
   * Server-side only. The provider's and the database's own words go on the log line and
   * nowhere near a response, which is why this exists here and not on the run. A traceId is
   * minted per line so an operator can correlate it with the run's terminal code.
   */
  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, {
      traceId: randomUUID(), err: detail.detail ?? message, ...detail,
    });
  };

  /**
   * One bounded batch: execute what is queued, then write back what is pending.
   *
   * The writeback runs AFTER execution so a message accepted in this tick is answered in
   * this tick, and it runs unconditionally so a run left `writeback_pending` by an earlier
   * failure -- or by a process that died mid-tick -- is retried without needing its own
   * reaper. One tick spends at most one attempt from §6's bounded budget.
   */
  async tick(orgId: OrgId): Promise<number> {
    // 2026-08-30 —— 见 `ports.ts` `AgentRunStore.reclaimStaleRunning` 的完整取证：这是
    // `running` 那一个此前没有任何"下一条消息自动捞回"路径的中间态在补的洞。
    // 独立 try/catch，绝不让这一步的失败拖垮它之后照旧要跑的 claim/writeback——
    // 与 `kick()` 自己 catch 掉 claim 失败、"下次 kick 再试"是同一条既有纪律。
    try {
      await this.runs.reclaimStaleRunning(orgId, this.staleRunningThresholdMs);
    } catch (e) {
      this.log("stale running run reclaim failed", {
        detail: e instanceof Error ? `${e.name}: ${e.message}` : "unknown", orgId,
      });
    }
    const executed = await executeQueuedRuns({
      runs: this.runs, model: this.model, clock: this.clock, log: this.log, usage: this.usage,
      files: this.files, contextSnapshots: this.contextSnapshots, toolTrace: this.toolTrace,
      canvasTemplates: this.canvasTemplates,
      runImages: this.runImages,
      sandbox: this.sandbox, objects: this.objects,
      planLedger: this.planLedger,
    }, { orgId });
    await writeBackPendingRuns({ runs: this.runs, clock: this.clock, log: this.log }, { orgId });
    return executed;
  }

  kick(orgId: OrgId): void {
    if (!this.autostart) return;
    void this.tick(orgId).catch(() => {
      // `tick` already records every run-level outcome durably. Reaching here means the
      // claim query itself failed; the runs stay `queued` and the next kick retries them.
      this.logger.error("agent run tick failed before claiming", {
        traceId: randomUUID(), err: "claim_failed", orgId,
      });
    });
  }
}
