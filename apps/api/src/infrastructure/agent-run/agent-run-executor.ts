/**
 * The executor as the process runs it (#414).
 *
 * ## Why acceptance kicks it, instead of a timer scanning for work
 *
 * `agent_runs` has RLS FORCEd, so a cross-tenant scan would read zero rows and look like
 * an empty queue forever -- the exact trap `database.port.ts` warns about for
 * `withoutTenant`, and the reason `pg-ingestion-repository` has no unscoped claim either.
 * A tenant is therefore named by something that already knows it: the request that just
 * accepted a message. `tick` claims every queued run for that tenant, so a run stranded by
 * a process restart is picked up by the next message in the same tenant rather than
 * needing its own reaper.
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
import type {
  AgentRunClock, AgentRunExecutorPort, AgentRunStore, ModelCallPort,
} from "../../application/agent-run/ports";
import { executeQueuedRuns } from "../../application/agent-run/execute-run";

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
  ) {}

  tick(orgId: OrgId): Promise<number> {
    return executeQueuedRuns({
      runs: this.runs,
      model: this.model,
      clock: this.clock,
      // Server-side only. The provider detail on the log line is precisely what must not
      // travel to a client, which is why it exists here and nowhere else. A traceId is
      // minted per line so an operator can correlate it with the run's terminal code.
      log: (message, detail) => this.logger.error(message, {
        traceId: randomUUID(), err: detail.detail ?? message, ...detail,
      }),
    }, { orgId });
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
