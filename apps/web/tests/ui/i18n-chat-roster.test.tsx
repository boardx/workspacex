import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RosterPanel, type RosterPanelProps } from "@/components/chat/chat-roster-panel";
import { identity } from "@repo/contracts";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(cleanup);
const agent = { id: "raw-agent", name: "组织原名 {name}", abbr: "OR", duty: "职责原文 {duty}", roleLabel: "组织头衔", presence: "present" as const };
const candidate = identity.CapabilityListing.parse({ id: "raw-candidate", orgId: "raw-org", kind: "agent", name: "候选原名 {name}", scope: "org-wide", enabled: true, endpoint: null, abbr: "CA", duty: "候选职责", disabledReason: null });
function props(): RosterPanelProps { return { roster: { agents: [agent], rosterCount: 1, presentCount: 1, rosterVersion: 7, marketEntry: null }, loading: false, error: null, hasSelection: true, canMutate: true, pending: false, mutateFailure: null, candidates: [candidate], candidatesError: null, onAdd: vi.fn(), onRemove: vi.fn(), onRetry: vi.fn() }; }
it("keeps org names, duties and selected canonical candidate while changing roster chrome", () => {
  const p = props();
  render(<I18nProvider initialLocale="en"><LocaleControl /><RosterPanel {...p} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const select = screen.getByTestId("chat-roster-add-input");
  fireEvent.change(select, { target: { value: candidate.id } });
  const row = screen.getByTestId("chat-roster-agent-raw-agent");
  expect(row.textContent).toContain(agent.name); expect(row.textContent).toContain(agent.duty); expect(within(row).getByText("Present")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-roster-add-input")).toBe(select); expect(select).toHaveValue(candidate.id);
  expect(screen.getByTestId("chat-roster-agent-raw-agent")).toBe(row); expect(row.textContent).toContain(agent.roleLabel);
  expect(p.onAdd).not.toHaveBeenCalled(); expect(p.onRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("chat-roster-add-submit")); expect(p.onAdd).toHaveBeenCalledTimes(1); expect(p.onAdd).toHaveBeenCalledWith(candidate.id);
});
it("preserves the readonly and pending mutation gates without inventing roster writes", () => {
  const p = props();
  const view = render(<I18nProvider initialLocale="en"><RosterPanel {...p} canMutate={false} /></I18nProvider>);
  expect(screen.getByText("Read only")).toBeTruthy(); expect(screen.queryByTestId("chat-roster-edit")).toBeNull(); expect(screen.queryByTestId("chat-roster-remove-raw-agent")).toBeNull();
  view.rerender(<I18nProvider initialLocale="en"><RosterPanel {...p} pending /></I18nProvider>);
  expect(screen.getByTestId("chat-roster-remove-raw-agent")).toBeDisabled();
  expect(p.onAdd).not.toHaveBeenCalled(); expect(p.onRemove).not.toHaveBeenCalled();
});
