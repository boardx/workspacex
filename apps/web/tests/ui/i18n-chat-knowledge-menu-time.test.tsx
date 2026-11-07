import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClaimEditMenu } from "@/components/chat/knowledge/claim-edit-menu";
import { ClaimTimeBadges } from "@/components/chat/knowledge/claim-time-badges";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KG_TODO_STATUS_LABEL_ZH, type KgClaim } from "@repo/contracts/chat-knowledge-graph";

let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);
const claim: KgClaim = { id: "raw-claim", scope: { kind: "chat_session", id: "raw-thread" }, kind: "fact", statement: "模型原文 {count}", status: "contested", triState: "conflict", confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 1, createdAt: "2026-11-04T00:00:00Z" };

it("keeps the real conflict menu open and permissions blocked on locale without choosing an action", async () => {
  const confirm = vi.fn(); const promote = vi.fn(); const open = vi.fn();
  render(<I18nProvider initialLocale="en"><Driver /><ClaimEditMenu claim={claim} canEdit hasObjects={false} onConfirm={confirm} onPromote={promote} onOpenDialog={open} /></I18nProvider>);
  const trigger = screen.getByRole("button", { name: "More" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = await screen.findByRole("menu");
  const disabled = screen.getByTestId("kg-action-confirm-raw-claim"); expect(disabled).toHaveAttribute("data-disabled");
  expect(screen.getByTestId("kg-confirm-blocked-raw-claim")).toHaveTextContent("Resolve the conflict before confirming");
  expect(screen.getByTestId("kg-action-promote-raw-claim")).toHaveAttribute("data-disabled");
  expect(screen.getByTestId("kg-action-merge-raw-claim")).toHaveAttribute("data-disabled");
  act(() => changeLocale()); expect(screen.getByRole("menu")).toBe(menu); expect(screen.getByTestId("kg-action-confirm-raw-claim")).toBe(disabled);
  expect(confirm).not.toHaveBeenCalled(); expect(promote).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(menu, { key: "Escape" }); expect(screen.queryByRole("menu")).toBeNull(); expect(open).not.toHaveBeenCalled();
});

it.each([
  { status: "open" as const, en: "Open" },
  { status: "done" as const, en: "Done" },
  { status: "dropped" as const, en: "Dropped" },
])("renders canonical $status time badges without replacing the same node on locale", ({ status, en }) => {
  render(<I18nProvider initialLocale="en"><Driver /><ClaimTimeBadges claim={{ todoStatus: status, dueAt: null, validUntil: null, expired: false }} /></I18nProvider>);
  const badge = screen.getByTestId(`kg-todo-status-${status}`); expect(badge).toHaveTextContent(en);
  act(() => changeLocale()); expect(screen.getByTestId(`kg-todo-status-${status}`)).toBe(badge); expect(badge).toHaveTextContent(KG_TODO_STATUS_LABEL_ZH[status]);
});
