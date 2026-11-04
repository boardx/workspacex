import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { UsageCalls, UsageSummary } from "@/lib/live-ai-usage";
const api = vi.hoisted(() => ({ readAiUsage: vi.fn(), readAiUsageCalls: vi.fn(), getUsageReport: vi.fn(), listLimitEvents: vi.fn() }));
vi.mock("@/lib/live-ai-usage", () => ({ readAiUsage: api.readAiUsage, readAiUsageCalls: api.readAiUsageCalls }));
vi.mock("@/lib/live-org-admin", async original => ({ ...(await original<typeof import("@/lib/live-org-admin")>()), getUsageReport: api.getUsageReport, listLimitEvents: api.listLimitEvents }));
vi.mock("@/lib/use-org-member-names", async original => ({ ...(await original<typeof import("@/lib/use-org-member-names")>()), useOrgMemberNames: () => new Map([["member-raw", "成员原文 {name}"]]) }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-usage-raw" } }) }));
import { AiUsagePanel } from "@/components/admin/ai-usage-panel";
import { UsageMonitorTab } from "@/components/admin/usage-monitor-tab";
function Language() { const { locale, setLocale } = useI18n(); return <button data-testid="usage-test-language" onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Test language</button>; }
function Locale({ children }: { children: React.ReactNode }) { return <I18nProvider initialLocale="en"><Language />{children}</I18nProvider>; }
const language = () => fireEvent.click(screen.getByTestId("usage-test-language"));
const totals = { inputTokens: "5", outputTokens: "3", totalTokens: "8", callCount: 1, failedCalls: 0, reportedCalls: 1, legacyCalls: 0, unknownCalls: 0, unknownInputCalls: 0, unknownOutputCalls: 0, nativeCalls: 0, creditHundredths: "12345", pendingCreditCalls: 0 };
const summary: UsageSummary = { asOf: "2026-10-03T00:00:00Z", start: "2026-10-01T00:00:00Z", end: "2026-10-03T00:00:00Z", timezone: "Asia/Shanghai", coverage: "partial", nativeUnits: [], current: totals, previous: totals, dispatchIntents: 2, unsettledDispatchIntents: 1,
  truncated: { members: false, models: false, matrix: false, projects: false }, trend: [{ day: "2026-10-02", totalTokens: "8", callCount: 1 }],
  members: [{ userId: "member-raw", totalTokens: "8", callCount: 1 }], models: [{ modelProvider: "provider-raw", modelId: "model-raw", totalTokens: "8", callCount: 1 }], matrix: [], projects: [{ projectId: null, totalTokens: "8", callCount: 1 }],
  costs: [{ currency: "CNY", costMicros: "1234567", pricedCalls: 1 }, { currency: "USD", costMicros: "1", pricedCalls: 1 }], unpricedCalls: 1, dailyCosts: [{ day: "2026-10-02", currency: "CNY", costMicros: "1234567", pricedCalls: 1 }, { day: "2026-10-02", currency: "USD", costMicros: "1", pricedCalls: 1 }],
};
const call = { id: "receipt-raw", userId: "member-raw", runId: null, projectId: null, threadId: null, agentId: null, modelProvider: "provider-raw", modelId: "model-raw", occurredAt: "2026-10-02T00:00:00.000001Z", startedAt: null, endedAt: null, executionAttemptId: null, totalTokens: "8", inputTokens: "5", outputTokens: "3", totalSource: "reported", outcome: "succeeded", callPurpose: null, costMicros: "1234567", currency: "CNY", priceVersion: null, cacheInputTokens: null, reasoningOutputTokens: null, subtaskId: null, nativeUsage: null, creditStatus: "pending", creditHundredths: "12345", payer: { ownerType: "team", ownerId: "org-usage-raw" }, organizationName: "组织原文 {org}" } as UsageCalls["calls"][number];
const report = { window: "week", totalTokens: 12345, callCount: 2, failedCallCount: 1, activeMemberCount: 1, models: ["model-raw"], rows: [{ userId: "member-raw", displayName: "成员原文 {name}", perModel: [12345], total: 12345 }], distribution: [{ modelId: "model-raw", tokens: 12345, share: 1 }] };
beforeEach(() => { for (const value of Object.values(api)) value.mockReset(); api.readAiUsage.mockResolvedValue(summary); api.readAiUsageCalls.mockResolvedValue({ asOf: summary.asOf, coverage: "partial", calls: [call], nextCursor: { occurredAt: call.occurredAt, id: call.id } }); api.getUsageReport.mockImplementation((_org: string, window: string) => Promise.resolve({ ...report, window })); api.listLimitEvents.mockResolvedValue({ events: [{ eventId: "event-raw", ruleId: "", actionTaken: "degrade", subjectRef: "作用对象原文 {ref}", observedTokens: 12345, thresholdTokens: 10000, occurredAt: "2026-10-02T03:04:05Z" }] }); });
afterEach(() => cleanup());
const tab = (name: string) => { const item = screen.getByRole("tab", { name }); fireEvent.mouseDown(item, { button: 0, ctrlKey: false }); fireEvent.click(item); };
it("translates overview and cost caveats while retaining chart metric/grain and separate currencies without reads", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale });
  const trend = await screen.findByRole("region", { name: "Usage trend" }); await waitFor(() => expect(api.readAiUsageCalls).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByText("CNY 1.234567").length).toBeGreaterThan(0); expect(screen.getAllByText("USD 0.000001").length).toBeGreaterThan(0);
  expect(screen.getByText(/Unpriced usage does not mean free usage/)).toBeVisible();
  fireEvent.click(within(trend).getByRole("button", { name: "Monthly" })); fireEvent.click(within(trend).getByRole("button", { name: "Calls" }));
  language(); expect(within(trend).getByRole("button", { name: "按月" })).toHaveAttribute("aria-pressed", "true"); language();
  expect(within(trend).getByRole("button", { name: "Calls" })).toHaveAttribute("aria-pressed", "true"); expect(api.readAiUsage).toHaveBeenCalledTimes(1); expect(api.readAiUsageCalls).toHaveBeenCalledTimes(1);
});
it("preserves custom dates and only sends inclusive Shanghai boundaries when explicitly applied", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale }); await screen.findByTestId("usage-total-tokens");
  fireEvent.click(screen.getByRole("button", { name: "Custom dates" })); fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } }); fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-02" } });
  language(); language(); expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-01"); expect(api.readAiUsage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" }));
  await waitFor(() => expect(api.readAiUsage).toHaveBeenLastCalledWith("org-usage-raw", false, expect.objectContaining({ start: "2026-09-30T16:00:00.000Z", end: "2026-10-02T16:00:00.000Z", timezone: "Asia/Shanghai", limit: 25 })));
});
it("retains a rejected custom range and retranslates its validation without a query", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale }); await screen.findByTestId("usage-total-tokens");
  fireEvent.click(screen.getByRole("button", { name: "Custom dates" }));
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-03" } }); fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply dates" })); const error = screen.getByRole("alert");
  expect(error).toHaveTextContent("Choose valid dates"); language(); expect(error).toHaveTextContent("结束日期不能早于开始日期"); language();
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-03"); expect(screen.getByLabelText("End date")).toHaveValue("2026-10-01"); expect(api.readAiUsage).toHaveBeenCalledTimes(1);
});
it("retains a raw member grouping filter and snapshot when language changes in the drilled ledger", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale }); await screen.findByRole("heading", { name: "Member ranking" });
  fireEvent.click(screen.getByRole("button", { name: "成员原文 {name} · 8" }));
  await waitFor(() => expect(api.readAiUsage).toHaveBeenLastCalledWith("org-usage-raw", false, expect.objectContaining({ userId: "member-raw", asOf: summary.asOf })));
  await waitFor(() => expect(api.readAiUsageCalls).toHaveBeenLastCalledWith("org-usage-raw", false, expect.objectContaining({ userId: "member-raw", asOf: summary.asOf })));
  const count = [api.readAiUsage.mock.calls.length, api.readAiUsageCalls.mock.calls.length]; language(); language();
  expect([api.readAiUsage.mock.calls.length, api.readAiUsageCalls.mock.calls.length]).toEqual(count); expect(screen.getByRole("tab", { name: "Call details" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("usage-ledger")).toHaveTextContent("成员原文 {name}");
});
it("translates ledger/account/financial states while preserving open details and raw organization/model names", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale }); await screen.findByTestId("usage-total-tokens"); tab("Call details");
  const ledger = await screen.findByTestId("usage-ledger"); expect(ledger).toHaveTextContent("Call time"); expect(ledger).toHaveTextContent("Organization account · 组织原文 {org}"); expect(ledger).toHaveTextContent("Pending reconciliation"); expect(ledger).toHaveTextContent("1.234567 CNY"); expect(ledger).toHaveTextContent("123.45"); expect(ledger).toHaveTextContent("成员原文 {name}"); expect(ledger).toHaveTextContent("Succeeded");
  expect(ledger).not.toHaveTextContent("receipt-raw"); const details = within(ledger).getByText("Metering details").closest("details")!; details.open = true; language(); language();
  expect(details.open).toBe(true); expect(ledger).toHaveTextContent("model-raw"); expect(api.readAiUsage).toHaveBeenCalledTimes(1); expect(api.readAiUsageCalls).toHaveBeenCalledTimes(1);
});
it("retains forced self scope and the exact microsecond snapshot/cursor across paging and language changes", async () => {
  render(<AiUsagePanel orgId="org-usage-raw" selfUserId="self-raw" />, { wrapper: Locale }); await screen.findByTestId("usage-total-tokens"); tab("Call details"); await screen.findByTestId("usage-ledger");
  fireEvent.click(screen.getByRole("button", { name: "Next page" })); await waitFor(() => expect(api.readAiUsageCalls).toHaveBeenCalledTimes(2)); language(); language();
  expect(api.readAiUsageCalls).toHaveBeenLastCalledWith("org-usage-raw", false, expect.objectContaining({ userId: "self-raw", asOf: summary.asOf, cursorTime: call.occurredAt, cursorId: call.id }), true);
  expect(api.readAiUsageCalls).toHaveBeenCalledTimes(2); expect(api.readAiUsage).toHaveBeenCalledTimes(1); expect(screen.getByRole("tab", { name: "Call details" })).toHaveAttribute("aria-selected", "true");
});
it("translates unknown/native statuses without replacing missing consumption with zero", async () => {
  api.readAiUsage.mockResolvedValue({ ...summary, current: { ...totals, totalTokens: "0", reportedCalls: 0, unknownCalls: 1 }, nativeUnits: [{ unit: "image", reportedQuantity: "0", estimatedQuantity: "0", reportedCalls: 0, estimatedCalls: 0, unknownCalls: 1 }] });
  api.readAiUsageCalls.mockResolvedValue({ asOf: summary.asOf, coverage: "partial", calls: [{ ...call, inputTokens: null, outputTokens: null, totalTokens: "0", totalSource: "not-applicable", nativeUsage: { unit: "millisecond", quantity: "2000", source: "estimated" } }], nextCursor: null });
  render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale }); expect(await screen.findByTestId("usage-total-tokens")).toHaveTextContent("Not reported"); tab("Call details");
  const ledger = await screen.findByTestId("usage-ledger"); expect(ledger).toHaveTextContent("2,000 milliseconds (estimated)"); expect(ledger).toHaveTextContent("Tokens not applicable"); expect(screen.queryByText(/0 images/)).toBeNull(); language(); expect(ledger).toHaveTextContent("2,000 毫秒（估算）");
});
it("retranslates a safe read error without retrying and reloads only on the explicit action", async () => {
  api.readAiUsage.mockRejectedValue(new Error("private upstream")); render(<AiUsagePanel orgId="org-usage-raw" />, { wrapper: Locale });
  const error = await screen.findByRole("alert"); expect(error).toHaveTextContent("Could not load usage"); language(); language(); expect(error).not.toHaveTextContent("private upstream"); expect(api.readAiUsage).toHaveBeenCalledTimes(1);
  api.readAiUsage.mockResolvedValue(summary); fireEvent.click(within(error).getByRole("button", { name: "Reload" })); await screen.findByTestId("usage-total-tokens"); expect(api.readAiUsage).toHaveBeenCalledTimes(2);
});
it("translates usage windows/matrix/event outcomes while preserving canonical windows, deleted-rule history and raw data", async () => {
  render(<UsageMonitorTab />, { wrapper: Locale }); const matrix = await screen.findByTestId("admin-usage-matrix");
  expect(within(matrix).getAllByRole("columnheader").map(node => node.textContent)).toEqual(["Member", "model-raw", "Total"]); expect(matrix).toHaveTextContent("成员原文 {name}");
  const event = await screen.findByTestId("admin-usage-event-event-raw"); expect(event).toHaveTextContent("Degraded"); expect(event).toHaveTextContent("Rule deleted"); expect(event).toHaveTextContent("作用对象原文 {ref}"); expect(event).toHaveTextContent("2026-10-02T03:04:05Z");
  fireEvent.click(screen.getByTestId("admin-usage-window-5h")); await waitFor(() => expect(api.getUsageReport).toHaveBeenLastCalledWith("org-usage-raw", "5h")); language(); language();
  expect(screen.getByTestId("admin-usage-window-5h")).toHaveAttribute("aria-pressed", "true"); expect(screen.getByTestId("admin-usage-window-5h")).toHaveTextContent("Last 5 hours"); expect(api.getUsageReport).toHaveBeenCalledTimes(2); expect(api.listLimitEvents).toHaveBeenCalledTimes(1);
});
it("does not claim failed calls have zero tokens when the actual report includes reported failed usage", async () => {
  api.getUsageReport.mockResolvedValue({ ...report, totalTokens: 23, callCount: 1, failedCallCount: 1, rows: [{ ...report.rows[0], perModel: [23], total: 23 }], distribution: [{ ...report.distribution[0], tokens: 23 }] });
  api.readAiUsage.mockResolvedValue({ ...summary, current: { ...totals, inputTokens: "20", totalTokens: "23", failedCalls: 1 }, costs: [], dailyCosts: [], unpricedCalls: 1 });
  api.readAiUsageCalls.mockResolvedValue({ asOf: summary.asOf, coverage: "partial", calls: [{ ...call, inputTokens: "20", totalTokens: "23", outcome: "failed", costMicros: null, currency: null }], nextCursor: null });
  render(<UsageMonitorTab />, { wrapper: Locale }); const failed = await screen.findByTestId("admin-usage-stat-failed");
  expect(failed).toHaveTextContent("Failed calls can include reported token usage"); expect(screen.getByTestId("admin-usage-stat-total")).toHaveTextContent("23");
  language(); expect(failed).toHaveTextContent("失败调用也可能包含已上报"); expect(failed).not.toHaveTextContent("失败不计");
  expect(screen.getByTestId("admin-usage-stat-total")).toHaveTextContent("23"); expect(api.getUsageReport).toHaveBeenCalledTimes(1);
});
