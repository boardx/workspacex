import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(cleanup);
it("keeps the read-only memory graph selection and visibility identity across locale without granting writes", () => {
  const data = knowledgeGraph.getThreadKnowledge.out.parse({ scope: { kind: "chat_session", id: "raw-thread" }, revision: 9, objects: [], claims: [], edges: [], ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: false, canPromote: false, visibility: "owner_only", extractionActive: false });
  const retry = vi.fn(); const source = vi.fn(); const apply = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgePanel status="ready" data={data} onRetry={retry} loadSources={source} writeActions={{ apply }} /></I18nProvider>);
  expect(screen.getByTestId("kg-readonly-badge").textContent).toBe("Read only");
  const visibility = screen.getByTestId("kg-visibility"); expect(visibility.textContent).toBe("Only you");
  expect(screen.getByTestId("kg-ingestion-inactive").textContent).toContain("Automatic memory is off");
  const graph = screen.getByRole("button", { name: "Relationship graph" }); fireEvent.click(graph);
  expect(graph).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("button", { name: "关系图" })).toBe(graph); expect(graph).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("kg-visibility")).toBe(visibility); expect(visibility).toHaveAttribute("data-visibility", "owner_only");
  expect(apply).not.toHaveBeenCalled(); expect(source).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  expect(screen.queryByTestId("kg-reindex")).toBeNull();
});
it("translates the structured permission failure and retries only on an explicit click", () => {
  const retry = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><KnowledgePanel status="error" data={null} errorCode="KG_NOT_VISIBLE" onRetry={retry} /></I18nProvider>);
  expect(screen.getByTestId("kg-error-reason").textContent).toBe("You do not have access to this conversation.");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("kg-error-reason").textContent).toBe("你没有这条对话的访问权限。");
  expect(retry).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "重试" })); expect(retry).toHaveBeenCalledTimes(1);
});
