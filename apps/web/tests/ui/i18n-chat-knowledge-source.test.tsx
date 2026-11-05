import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
import { KnowledgeGraphError, type ClaimSources } from "@/lib/knowledge-graph-api";
let changeLocale: () => void = () => {};
function LocaleControl() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
const scope = { kind: "chat_session" as const, id: "raw-thread" };
const claim = { id: "raw-claim", scope, kind: "fact" as const, statement: "原始记忆 {count}", status: "proposed" as const, triState: "pending" as const, confidence: 0.8, createdBy: "model" as const, reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-11-04T00:00:00Z" };
const data = knowledgeGraph.getThreadKnowledge.out.parse({ scope, revision: 7, objects: [], claims: [claim], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: false, canPromote: false, visibility: "owner_only", extractionActive: true });
const sources = knowledgeGraph.getClaimSources.out.parse({ claim, evidence: [{ segmentId: "raw-segment", stance: "supporting", sourceKind: "chat_message", sourceRef: "raw-message", excerpt: "用户证据原文 {source}", locator: null, revoked: false }], provenance: [{ at: "2026-11-04T00:00:00Z", actor: { kind: "system", id: "raw-actor" }, action: "原始操作 {action}", pipelineVersion: "raw-pipeline" }] });
afterEach(cleanup);
it("preserves a pending source request and raw claim/evidence while only translating the real drawer", async () => {
  let resolve!: (value: ClaimSources) => void; const load = vi.fn(() => new Promise<ClaimSources>(done => { resolve = done; })); const jump = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgePanel status="ready" data={data} loadSources={load} onJumpToSource={jump} /></I18nProvider>);
  fireEvent.click(screen.getByTestId("kg-claim-open-raw-claim"));
  const drawer = screen.getByRole("dialog", { name: "Memory sources" }); expect(screen.getByText("Sources and evidence")).toBeTruthy();
  expect(screen.getByTestId("kg-source-drawer-loading")).toHaveAttribute("aria-busy", "true");
  act(() => changeLocale()); expect(screen.getByRole("dialog", { name: "记忆来源" })).toBe(drawer); expect(load).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledWith(claim.id);
  await act(async () => { resolve(sources); });
  expect(screen.getByTestId("kg-source-statement").textContent).toBe(claim.statement); expect(screen.getByTestId("kg-evidence-raw-segment").textContent).toContain(sources.evidence[0]!.excerpt);
  expect(screen.getByTestId("kg-provenance-0").textContent).toContain(sources.provenance[0]!.action);
  expect(jump).not.toHaveBeenCalled(); fireEvent.click(screen.getByTestId("kg-evidence-jump-raw-segment")); expect(jump).toHaveBeenCalledWith({ claim: sources.claim, sourceKind: "chat_message", sourceRef: "raw-message" }); expect(load).toHaveBeenCalledTimes(1);
});
it("re-renders a stored permission error, retries only explicitly and ignores its late reply after close", async () => {
  const load = vi.fn<() => Promise<ClaimSources>>().mockRejectedValue(new KnowledgeGraphError("KG_NOT_VISIBLE", 403));
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgePanel status="ready" data={data} loadSources={load} /></I18nProvider>);
  fireEvent.click(screen.getByTestId("kg-claim-open-raw-claim")); const failure = await screen.findByTestId("kg-source-drawer-error");
  expect(failure.textContent).toContain("You do not have permission to view this source.");
  act(() => changeLocale()); expect(screen.getByTestId("kg-source-drawer-error")).toBe(failure); expect(failure.textContent).toContain("你没有权限查看这一条的来源。"); expect(load).toHaveBeenCalledTimes(1);
  let resolve!: (value: ClaimSources) => void; load.mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByTestId("kg-source-drawer-retry")); expect(load).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByTestId("kg-source-drawer-close")); expect(screen.queryByTestId("kg-source-drawer")).toBeNull();
  await act(async () => { resolve(sources); }); expect(screen.queryByTestId("kg-source-drawer")).toBeNull();
});
