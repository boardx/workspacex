/** Claim projection only over a recording tenant port; PostgreSQL/RLS is tested separately. */
import { expect, it, vi } from "vitest";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { guard } from "../../src/application/security/permission-filter";
import { AIDT_REFERENCE_ORG as org, frozenStoredFixture } from "../support/aidt-context-fixture";
function database(marker: string | null) {
  const query = vi.fn();
  query.mockResolvedValueOnce({ rows: [{ id: "thread" }] });
  query.mockResolvedValueOnce({ rows: [{ id: "run", thread_id: "thread", input_message_id: "message", agent_id: "agent", agent_version_id: "agent-v1", skill_version_ids: ["skill-v1"], model_provider: "offline", model_id: "offline", runtime_profile: "legacy", pending_decision: null, aidt_selector_hash: marker }] });
  query.mockResolvedValueOnce({ rows: [{ id: "run", project_id: "project", input_text: "  exact user\n ", instructions: "Pinned system", requester_user_id: "student", skill_scope: "general", agent_pinned_skill_version_ids: [], input_attachments: [], max_step_seq: 1 }] });
  const session: TenantSession = { query };
  const db: DatabasePort = { withTenant: async (requested, work) => { expect(requested).toBe(org); return work(session); }, withoutTenant: async () => { throw new Error("Global reads forbidden"); }, close: async () => {} };
  return { db, session, query };
}
it("keeps an ordinary claim free of snapshot lookup and payload fields", async () => {
  const { db } = database(null), reader = { readIn: vi.fn(async () => guard({ kind: "project", id: "project" }, frozenStoredFixture())) };
  const result = await new PgAgentRunRepository(db, null, reader).claimQueued(org, 1);
  expect(result[0]?.kind).toBe("executable"); expect(reader.readIn).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("aidtContext"); expect(JSON.stringify(result)).not.toContain("modelReferenceBlock");
});
it("passes only the actual guarded snapshot onward without disclosing it during claim", async () => {
  const stored = frozenStoredFixture(), { db, session } = database(stored.selectorHash), guarded = guard({ kind: "project", id: "project" }, stored);
  const reader = { readIn: vi.fn(async () => guarded) }, result = await new PgAgentRunRepository(db, null, reader).claimQueued(org, 1);
  expect(reader.readIn).toHaveBeenCalledWith(session, org, "run");
  expect(result[0]?.kind).toBe("executable");
  if (result[0]?.kind !== "executable") throw new Error("Expected claim");
  expect(result[0].run.aidtContext).toBe(guarded); expect(result[0].run.aidtSelectorHash).toBe(stored.selectorHash);
  expect(JSON.stringify(result)).not.toContain(stored.snapshot.modelReferenceBlock); expect(result[0].run.inputText).toBe("  exact user\n ");
});
it.each(["missing-reader", "missing-snapshot", "invalid-stored-hash", "foreign-ref"])("marks an expected %s unresolvable rather than ordinary", async kind => {
  const { db } = database(frozenStoredFixture().selectorHash);
  const reader = { readIn: vi.fn(async () => {
    if (kind === "missing-snapshot") return null;
    if (kind === "invalid-stored-hash") throw new Error("Stored snapshot hash mismatch");
    return guard({ kind: "project", id: kind === "foreign-ref" ? "other-project" : "project" }, frozenStoredFixture());
  }) };
  const result = await new PgAgentRunRepository(db, null, kind === "missing-reader" ? undefined : reader).claimQueued(org, 1);
  expect(result).toEqual([{ kind: "unresolvable", runId: "run", leaseEpoch: undefined }]);
});
