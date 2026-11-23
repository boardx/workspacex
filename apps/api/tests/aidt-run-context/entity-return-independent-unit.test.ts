import { expect, it, vi } from "vitest";
import { AIDT_STAGE_IDENTITIES, type AidtContextSelector } from "@repo/contracts/aidt-run-context";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { PgAidtRunContextProvider } from "../../src/infrastructure/aidt-run-context/pg-aidt-run-context-provider";
import { aidtEntityThreadId } from "../../src/application/aidt-stages/entity-thread";
import { toOrgId } from "../../src/domain/org-id";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import type { AidtRunContextSnapshotStore } from "../../src/application/aidt-run-context/ports";

// This suite exercises real prepareIn/thread-selector/checkReturn/prepare behavior.
// Private DB access/focus ports are isolated; it is not a PostgreSQL permission or model test.
const base = { orgId: toOrgId("qa-org"), projectId: "qa-project", userId: "qa-member" };
const entity = "qa-current-entity", thread = aidtEntityThreadId(base, 2, entity, "stage");
const actor = { ...base, threadId: thread };
const selector: AidtContextSelector = { schemaVersion: 1, projectId: base.projectId, purpose: "stage", stageId: 2, entityId: entity, stageRevisions: [], returnRevision: 9 };
function row(): SharedStageValue {
  return { projectId: base.projectId, stageId: 6, revision: 9, sourceStageRevisions: [], updatedBy: "qa", updatedAt: "2026-11-22T08:00:00Z", content: { schemaVersion: 1, draft: { fields: {
    questionSnapshot: JSON.stringify({ schemaVersion: 1, question: "合成旧问题", beforeTestBelief: "旧预期", verificationBasis: "QA", verificationLimits: "待真实验证", prototypeRef: "old-v2", sourceStageRevision: null }),
    version: "old-v2", understandingChangeStatus: "insufficient", unresolvedQuestions: "证据不足", returnStep: "2", returnReason: "补访", nextAction: "核对情境", reflectionConfirmed: "true",
  }, ideas: [], selectedIdeaId: "" } } };
}
function fixture(stage = row()) {
  const session = { query: vi.fn(async () => ({ rows: [{ timeout: "0" }], rowCount: 1 })) } as unknown as TenantSession;
  const db: DatabasePort = { async withTenant() { throw new Error("Unexpected outer DB access"); }, async withoutTenant() { throw new Error("Forbidden"); }, async close() {} };
  const store = { readIn: vi.fn(), readScopeIn: vi.fn(), saveIn: vi.fn(), appendIn: vi.fn(), eventsIn: vi.fn() } as AidtRunContextSnapshotStore;
  const provider = new PgAidtRunContextProvider(db, { load: vi.fn() }, store, () => true);
  const stages = { list: vi.fn(async () => ({ items: [stage] })), getRevision: vi.fn(async () => ({ stage })) };
  const access = vi.fn(async () => ({ decision: {}, stages, db }));
  const focus = vi.fn(async () => ({ skillId: "qa-skill", skillVersionId: "qa-skill-version", skillStableName: AIDT_STAGE_IDENTITIES.find(item => item.id === 2)!.skill, title: "共情用户" }));
  Reflect.set(provider, "accessIn", access); Reflect.set(provider, "focusIn", focus);
  return { provider, session, access, stages };
}
const run = { runId: "qa-run", inputMessageId: "qa-message", skillVersionIds: ["qa-skill-version"] };
it("accepts a legal entity-owned thread plus exact confirmed returnRevision through real preparation", async () => {
  const f = fixture(), result = await f.provider.prepareIn(f.session, actor, selector, run);
  expect(f.access).toHaveBeenCalledOnce(); expect(f.stages.getRevision).toHaveBeenCalledWith(actor, 6, 9);
  expect(result.snapshot.selector).toMatchObject({ entityId: entity, returnRevision: 9 });
  expect(result.snapshot.modelReferenceBlock).toContain("合成旧问题");
  expect(result.snapshot.modelReferenceBlock).toContain("not-verified");
});
it("rejects wrong entity thread, cross-project and entity selector on ordinary Chat before tenant access", async () => {
  for (const [who, requested] of [
    [{ ...actor, threadId: aidtEntityThreadId(base, 2, "sibling", "stage") }, selector],
    [actor, { ...selector, projectId: "another-project" }],
    [{ ...actor, threadId: "ordinary-thread" }, selector],
    [actor, { ...selector, entityId: undefined }],
  ] as const) {
    const f = fixture();
    await expect(f.provider.prepareIn(f.session, who, requested as AidtContextSelector, run)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
    expect(f.access).not.toHaveBeenCalled();
  }
});
it("retains exact-history, confirmation, project and target-stage refusal after the new legal combination", async () => {
  const changed = (key: string, value: string) => { const stage = row(); stage.content.draft.fields[key] = value; return stage; };
  for (const stage of [
    changed("reflectionConfirmed", ""), changed("returnStep", "5"), changed("returnReason", ""),
    { ...row(), projectId: "another-project" }, { ...row(), revision: 10 },
  ]) {
    const f = fixture(stage);
    await expect(f.provider.prepareIn(f.session, actor, selector, run)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
  }
});
