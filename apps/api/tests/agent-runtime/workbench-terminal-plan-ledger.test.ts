import { expect, it } from "vitest";
import { getPlanLedger } from "../../src/application/plan-control/get-plan-ledger";
import type { PlanLedgerRepository, PlanRunStatusReader, PlanRunSnapshot } from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";
const repo = { getLatest: async () => null, listOrphanedConstraints: async () => [] } as unknown as PlanLedgerRepository;
it.each(["succeeded", "failed", "cancelled"] as const)("%s suppresses historical pause and pending approval controls", async status => {
  const run: PlanRunSnapshot = { runId: "run", status, pausedAt: "2026-09-07T00:00:00Z", pauseRequestedAt: "2026-09-06T23:59:00Z", pendingToolName: "call_skill", createdAt: "2026-09-06T23:00:00Z", agentId: "agent", remoteRunId: null, errorCode: status === "failed" ? "MODEL_CALL_FAILED" : null };
  const reader: PlanRunStatusReader = { getLatestRun: async () => run, recordRemoteRunId: async () => { throw new Error("read must not write"); }, markRunPaused: async () => { throw new Error("read must not write"); } };
  const out = await getPlanLedger(repo, reader, { orgId: toOrgId("org"), threadId: "thread" });
  expect(out.phase).toBe(status === "succeeded" ? "done" : status);
  expect(out.activeRunId).toBeNull();
  expect(out.pausedAt).toBeNull(); expect(out.pauseRequestedAt).toBeNull();
  expect(out.errorCode).toBe(status === "failed" ? "MODEL_CALL_FAILED" : null);
  expect(run.pausedAt).not.toBeNull();
});
