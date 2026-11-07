import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { KnowledgeGraphError } from "@/lib/knowledge-graph-api";
import { onRememberStatement } from "@/lib/knowledge-graph-events";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";

const scope = { kind: "chat_session" as const, id: "raw-thread" };
const claim = { id: "raw-claim", scope, kind: "fact" as const, statement: "模型原始记忆 {count}", status: "proposed" as const, triState: "pending" as const, confidence: 0.8, createdBy: "model" as const, reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-11-04T00:00:00Z" };
const data = knowledgeGraph.getThreadKnowledge.out.parse({ scope, revision: 7, objects: [], claims: [claim], edges: [], ingestion: { queued: 2, running: 1, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true });
let changeLocale: () => void = () => {};
let switchToEnglish: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); switchToEnglish = () => setLocale("en"); return () => { changeLocale = () => {}; switchToEnglish = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);

it("retains a manually authored quick-add draft across locale and dispatches only its raw explicit event", () => {
  const apply = vi.fn(async () => {}); const remember = vi.fn(); const unsubscribe = onRememberStatement(remember);
  try {
    render(<I18nProvider initialLocale="en"><Driver /><KnowledgePanel status="ready" data={data} writeActions={{ apply }} /></I18nProvider>);
    expect(screen.getByTestId("kg-ingestion-running")).toHaveTextContent("Organizing (3)");
    fireEvent.click(screen.getByTestId("kg-remember-quick-add-open"));
    const input = screen.getByRole("textbox", { name: "A sentence to remember" });
    const raw = "用户手写 {locale} const raw = '{name}';";
    fireEvent.change(input, { target: { value: raw } });
    act(() => changeLocale()); expect(screen.getByRole("textbox", { name: "要记住的一句话" })).toBe(input); expect(input).toHaveValue(raw);
    expect(remember).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("kg-remember-quick-add-submit"));
    expect(remember).toHaveBeenCalledTimes(1); expect(remember).toHaveBeenCalledWith(raw); expect(apply).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
});

it("updates a persisted edit permission failure only at render, without reapplying on locale", async () => {
  const apply = vi.fn(async () => { throw new KnowledgeGraphError("KG_NOT_OWNER", 403); });
  render(<I18nProvider initialLocale="en"><Driver /><KnowledgePanel status="ready" data={data} writeActions={{ apply }} /></I18nProvider>);
  fireEvent.click(screen.getByTestId("kg-row-yes-raw-claim"));
  const notice = await screen.findByTestId("kg-action-error");
  expect(notice).toHaveTextContent("Only the conversation creator can edit its memories.");
  expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith({ type: "confirmClaim", claimId: claim.id });
  act(() => changeLocale()); expect(screen.getByTestId("kg-action-error")).toBe(notice); expect(notice).not.toHaveTextContent("KG_NOT_OWNER"); expect(apply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("kg-action-error-dismiss")); expect(screen.queryByTestId("kg-action-error")).toBeNull(); expect(apply).toHaveBeenCalledTimes(1);
});

it("keeps one pending promotion and selected raw IDs through locale and formats its stored rejection", async () => {
  let reject!: (cause: unknown) => void;
  const promote = vi.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; })); const apply = vi.fn(async () => {});
  render(<I18nProvider initialLocale="en"><Driver /><KnowledgePanel status="ready" data={data} writeActions={{ apply, onPromote: promote }} /></I18nProvider>);
  fireEvent.click(screen.getByTestId("kg-promote-enter")); fireEvent.click(screen.getByTestId("kg-claim-select-raw-claim"));
  const submit = screen.getByTestId("kg-promote-submit"); expect(submit).toHaveTextContent("Save to my long-term memory (1)");
  fireEvent.click(submit); expect(promote).toHaveBeenCalledTimes(1); expect(promote).toHaveBeenCalledWith([claim.id], undefined);
  act(() => changeLocale()); expect(promote).toHaveBeenCalledTimes(1); expect(apply).not.toHaveBeenCalled();
  await act(async () => { reject(new KnowledgeGraphError("KG_SCOPE_NOT_PERSONAL", 400)); });
  const notice = screen.getByTestId("kg-action-error"); expect(notice).toHaveTextContent("只有你自己的个人对话，才能把记忆记到长期记忆。"); expect(notice).not.toHaveTextContent("KG_SCOPE_NOT_PERSONAL"); expect(promote).toHaveBeenCalledTimes(1);
  act(() => switchToEnglish()); expect(screen.getByTestId("kg-action-error")).toBe(notice); expect(notice).toHaveTextContent("Only your own personal conversations can be saved to long-term memory."); expect(promote).toHaveBeenCalledTimes(1);
});
