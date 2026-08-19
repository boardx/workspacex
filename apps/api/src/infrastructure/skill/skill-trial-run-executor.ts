/**
 * `SkillTrialRunExecutorPort` 的实现（F962 §6.1）—— 形态照抄
 * `infrastructure/agent-run/agent-run-executor.ts`，包括它那条最关键的设计：
 *
 * ## ⚠ 为什么是「提交后 kick」，不是定时器扫表
 *
 * `skill_trial_runs` 是 `FORCE ROW LEVEL SECURITY`。一个不带租户上下文的后台扫描
 * **永远看到 0 行** —— 它不会报错，只会安静地什么都不做，看起来像"队列是空的"。
 * 所以推动力必须来自一个**已经知道 orgId** 的调用点，也就是提交那一刻。
 *
 * ⚠ 这条不是可以"以后换成 cron 优化"的实现细节：换成 cron 的那一刻，队列就永远空转。
 */
import { randomUUID } from "node:crypto";
import type { LoggerPort } from "../../application/ports/logger.port";
import type { OrgId } from "../../domain/org-id";
import {
  executeQueuedTrialRuns,
  type ExecuteTrialRunDeps,
} from "../../application/skill/execute-trial-run";
import type { SkillTrialRunExecutorPort } from "../../application/skill/trial-run-async-ports";

export class SkillTrialRunExecutor implements SkillTrialRunExecutorPort {
  constructor(
    private readonly deps: Omit<ExecuteTrialRunDeps, "log">,
    private readonly logger: LoggerPort,
    /** `KERNEL_SKILL_TRIALRUN_AUTOSTART !== "0"`，同 agent run 的开关形态。 */
    private readonly autostart: boolean,
  ) {}

  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.code ?? message, ...detail });
  };

  tick(orgId: OrgId): Promise<number> {
    return executeQueuedTrialRuns({ ...this.deps, log: this.log }, { orgId });
  }

  kick(orgId: OrgId): void {
    if (!this.autostart) return;
    /**
     * ⚠ catch 必须在这里兜住。`kick` 是 fire-and-forget，一个逃出去的 rejection
     * 在 Node 里是 unhandledRejection —— 会把整个 API 进程带下去，而起因只是一次
     * 试跑没跑起来。认领到的行由 `executeQueuedTrialRuns` 内部保证走到终态；
     * 这里兜的是**认领之前**就失败（比如数据库连不上）的情形。
     */
    void this.tick(orgId).catch(() => {
      this.logger.error("skill trial run tick failed before claiming", {
        traceId: randomUUID(),
        err: "claim_failed",
        orgId,
      });
    });
  }
}
