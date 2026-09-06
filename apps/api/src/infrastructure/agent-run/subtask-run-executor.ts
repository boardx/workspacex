import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { LoggerPort } from "../../application/ports/logger.port";
import { SUBTASK_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/subtask-run-queue";
import type { ModelCallPort } from "../../application/agent-run/ports";
import { executeQueuedSubtaskRuns, type SubtaskRunStore } from "../../application/agent-run/subtask-run-queue";
import type { OrgId } from "../../domain/org-id";

/** Same tenant-scoped kick/tick lifecycle as AgentRunExecutor. No global RLS scan.
 * A later tenant query/kick recovers persisted work after a process restart. */
export class SubtaskRunExecutor {
  constructor(private readonly store: SubtaskRunStore, private readonly db: DatabasePort,
    private readonly model: ModelCallPort, private readonly logger: LoggerPort,
    private readonly autostart: boolean,
    private readonly executionTimeouts: ReadonlyMap<string, number> = new Map()) {}

  async tick(orgId: OrgId): Promise<number> {
    let executed = 0;
    for (let count = 0; count < 10; count += 1) {
      const claimed = await executeQueuedSubtaskRuns({ store: this.store,
      log: (message, detail) => this.logger.error(message, { ...detail, traceId: randomUUID(), err: detail.detail ?? message }),
      execute: async (run) => {
        const parent = await this.db.withTenant(orgId, async (s) => {
          const r = await s.query<{ model_provider: string; model_id: string; instructions: string }>(
            `SELECT r.model_provider,r.model_id,v.instructions FROM agent_runs r
             JOIN agent_versions v ON v.id=r.agent_version_id AND v.org_id=r.org_id
             WHERE r.org_id=$1 AND r.id=$2 AND v.published_at IS NOT NULL`, [orgId,run.parentRunId]);
          return r.rows[0];
        });
        if (!parent) throw new Error("subtask_parent_snapshot_unavailable");
        // Only known text-only adapters with a deadline safely below recovery are supported.
        // Do not simulate cancellation with Promise.race while the real model keeps running.
        const timeout = this.executionTimeouts.get(parent.model_provider);
        if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0
          || timeout + 60_000 >= SUBTASK_STALE_RUNNING_THRESHOLD_MS) {
          throw new Error("subtask_provider_timeout_or_execution_mode_unsupported");
        }
        const completion = await this.model.complete({ modelProvider: parent.model_provider,
          modelId: parent.model_id, system: parent.instructions,
          user: run.context ? `${run.description}\n\nContext:\n${run.context}` : run.description,
          history: [], skills: [], orgId: String(orgId), executionMode: "text-only" });
        return completion.text;
      },
    }, { orgId, limit: 1 });
      executed += claimed;
      if (claimed === 0) break;
    }
    return executed;
  }

  kick(orgId: OrgId): void {
    if (!this.autostart) return;
    void this.tick(orgId).catch((error: unknown) => {
      this.logger.error("subtask queue tick failed", { traceId: randomUUID(), orgId,
        err: error instanceof Error ? error.message : "claim_failed" });
    });
  }
}
