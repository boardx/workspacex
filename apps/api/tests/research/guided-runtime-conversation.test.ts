import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type GuidedRuntimeStore, type RuntimeCommand } from "../../src/application/research/guided-runtime-ports";
import { toOrgId } from "../../src/domain/org-id";

function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "session", title: "Research", brief: { topic: "Grid", goal: "Entry", region: "EU", focus: "Policy", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  let state = initialRuntime(session);
  const store: GuidedRuntimeStore = {
    read: async () => structuredClone(state),
    claim: async (_actor, command) => {
      if (command.expectedVersion !== state.version) throw new ResearchRuntimeError("RESEARCH_GRAPH_VERSION_CONFLICT");
      state.version++; state.busy = true; state.errorCode = null;
      return { state: structuredClone(state), replay: false };
    },
    write: async (_actor, _request, value) => { state = structuredClone(value); },
  };
  const complete = vi.fn(async (_input: { system: string; user: string }) => ({ text: JSON.stringify({ assistantMessage: "建议聚焦德国市场", value: { ...session.brief, region: "Germany" }, action: "save" }) }));
  const search = vi.fn();
  const service = new GuidedRuntimeService(store, { complete }, { search }, { provider: "test", id: "test" });
  const actor = { orgId: toOrgId("org"), userId: "owner", sessionId: session.sessionId };
  let request = 0;
  const run = (extra: Pick<RuntimeCommand, "action"> & Partial<RuntimeCommand>) => service.execute(actor, session, { sessionId: session.sessionId, node: "brief", expectedVersion: state.version, requestId: `request-${++request}`, ...extra });
  return { session, complete, search, run, latest: () => state };
}

describe("research conversation draft continuity", () => {
  it("provides the unapproved proposal to the next turn without applying or executing it", async () => {
    const f = fixture();
    const first = await f.run({ action: "message", message: "聚焦德国市场" });
    const proposed = first.proposal!;
    const second = await f.run({ action: "message", message: "再补充电网接入政策" });
    const input = JSON.parse(f.complete.mock.calls[1]![0].user);
    expect(input.pendingProposal).toEqual(proposed);
    expect(input.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(second.brief).toEqual(f.session.brief);
    expect(second.currentNode).toBe("brief");
    expect(f.search).not.toHaveBeenCalled();
    expect(second.proposal?.id).not.toBe(proposed.id);
    const stale = await f.run({ action: "apply", proposalId: proposed.id });
    expect(stale.errorCode).toBe("RESEARCH_GRAPH_VERSION_CONFLICT");
    expect(stale.brief).toEqual(f.session.brief);
  });

  it("gives the page draft precedence while retaining the previous suggestion as context", async () => {
    const f = fixture();
    const first = await f.run({ action: "message", message: "聚焦德国市场" });
    const draft = { node: "brief" as const, value: { ...f.session.brief, region: "France" } };
    await f.run({ action: "message", message: "以页面修改为准，补充目标", draft });
    const input = f.complete.mock.calls[1]![0];
    expect(JSON.parse(input.user)).toMatchObject({ draft, pendingProposal: first.proposal });
    expect(input.system).toContain("Use the supplied draft as the primary editing basis");
    expect(f.latest().brief).toEqual(f.session.brief);
  });

  it("preserves the discussion's detailed directions, with explicit page edits taking precedence", async () => {
    const f = fixture();
    const state = f.latest();
    state.currentNode = "directions"; state.availableNodes.push("directions");
    const direction = { id: "d1", title: "Policy", description: "Grid access", enabled: true, order: 0 };
    const suggested = { ...direction, evidenceNeeds: ["Official German grid rules"] };
    state.proposal = { id: "pending", version: state.version, draft: { node: "directions", value: [suggested] }, action: "save" };
    f.complete.mockResolvedValue({ text: JSON.stringify({ assistantMessage: "继续完善方向", value: [direction], action: "save" }) });
    const continued = await f.run({ action: "message", node: "directions", message: "继续细化" });
    expect(continued.proposal?.draft.value).toEqual([suggested]);
    const edited = { ...direction, evidenceNeeds: ["Official French grid rules"] };
    const next = await f.run({ action: "message", node: "directions", message: "以页面修改为准", draft: { node: "directions", value: [edited] } });
    expect(next.proposal?.draft.value).toEqual([edited]);
    expect(next.directions).toEqual([]);
  });

  it("retains the previous suggestion after model failure without making it applicable", async () => {
    const f = fixture();
    const first = await f.run({ action: "message", message: "聚焦德国市场" });
    f.complete.mockRejectedValueOnce(new Error("provider unavailable"));
    const failed = await f.run({ action: "message", message: "继续补充" });
    expect(failed.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(failed.proposal).toEqual(first.proposal);
    expect(failed.proposal!.version).toBeLessThan(failed.version);
    expect(failed.brief).toEqual(f.session.brief);
    const applied = await f.run({ action: "apply", proposalId: failed.proposal!.id });
    expect(applied.errorCode).toBe("RESEARCH_GRAPH_VERSION_CONFLICT");
    expect(applied.brief).toEqual(f.session.brief);
  });

  it.each(["outdated", "other-node"] as const)("does not send a %s proposal as the current suggestion", async (kind) => {
    const f = fixture();
    await f.run({ action: "message", message: "聚焦德国市场" });
    const state = f.latest();
    if (kind === "outdated") state.proposal!.version--;
    else state.proposal!.draft = { node: "research", value: [] };
    await f.run({ action: "message", message: "继续调整" });
    expect(JSON.parse(f.complete.mock.calls[1]![0].user)).not.toHaveProperty("pendingProposal");
  });
});
