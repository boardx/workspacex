import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { KnowledgeList, KnowledgeEmpty } from "@/components/chat/knowledge/knowledge-list";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { KgClaim } from "@repo/contracts/chat-knowledge-graph";

const raw = "模型原文 {count} const code = '{locale}';";
const claim: KgClaim = { id: "raw-claim", scope: { kind: "chat_session", id: "raw-thread" }, kind: "fact", statement: raw, status: "proposed", triState: "pending", confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 3, contradictingCount: 1, createdAt: "2026-11-04T00:00:00Z" };
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);

it("keeps an expanded correction row and raw source action through locale without a write", () => {
  const apply = vi.fn(async () => true); const source = vi.fn();
  render(<I18nProvider initialLocale="en"><Driver /><KnowledgeList claims={[claim]} canEdit selectable={false} selected={{}} onApply={apply} onOpenSource={source} /></I18nProvider>);
  const row = screen.getByTestId("kg-claim-raw-claim");
  expect(screen.getByTestId("kg-group-fact")).toHaveTextContent("Fact");
  expect(row).toHaveTextContent("Evidence 3"); expect(row).toHaveTextContent("Opposing 1"); expect(row).toHaveTextContent(raw);
  fireEvent.click(within(row).getByRole("button", { name: "Wrong" }));
  const controls = within(row).getByTestId("kg-row-wrong-options-raw-claim");
  expect(controls).toHaveTextContent("Forget this");
  act(() => changeLocale());
  expect(screen.getByTestId("kg-claim-raw-claim")).toBe(row);
  expect(within(row).getByTestId("kg-row-wrong-options-raw-claim")).toBe(controls);
  expect(apply).not.toHaveBeenCalled(); expect(source).not.toHaveBeenCalled(); expect(row).toHaveTextContent(raw);
  fireEvent.click(within(row).getByTestId("kg-claim-open-raw-claim")); expect(source).toHaveBeenCalledTimes(1); expect(source).toHaveBeenCalledWith(claim);
  fireEvent.click(within(row).getByTestId("kg-row-forget-raw-claim")); expect(apply).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledWith({ type: "revokeClaim", claimId: claim.id });
});

it("keeps readonly selection identity and never renders edit actions", () => {
  const toggle = vi.fn(); const apply = vi.fn(async () => true);
  render(<I18nProvider initialLocale="en"><Driver /><KnowledgeList claims={[claim]} canEdit={false} selectable selected={{ [claim.id]: true }} onToggleSelect={toggle} onApply={apply} /></I18nProvider>);
  const checkbox = screen.getByRole("checkbox", { name: `Select ${raw}` });
  expect(checkbox).toBeChecked(); expect(screen.queryByTestId("kg-claim-edit-trigger-raw-claim")).toBeNull();
  act(() => changeLocale()); expect(screen.getByRole("checkbox", { name: `选择 ${raw}` })).toBe(checkbox); expect(checkbox).toBeChecked();
  expect(toggle).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  fireEvent.click(checkbox); expect(toggle).toHaveBeenCalledTimes(1); expect(toggle).toHaveBeenCalledWith(claim.id, false); expect(apply).not.toHaveBeenCalled();
});

it("only organizes the conversation on explicit empty-state action", () => {
  const organize = vi.fn();
  render(<I18nProvider initialLocale="en"><Driver /><KnowledgeEmpty onReindex={organize} /></I18nProvider>);
  const button = screen.getByRole("button", { name: "Organize this conversation" });
  act(() => changeLocale()); expect(screen.getByRole("button", { name: "整理本会话" })).toBe(button); expect(organize).not.toHaveBeenCalled();
  fireEvent.click(button); expect(organize).toHaveBeenCalledTimes(1);
});
