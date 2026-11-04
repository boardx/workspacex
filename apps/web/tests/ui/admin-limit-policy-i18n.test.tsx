import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({ orgId: "org-limits-raw" as string | null, listLimitRules: vi.fn(), createLimitRule: vi.fn(), updateLimitRule: vi.fn(), deleteLimitRule: vi.fn() }));
vi.mock("@/lib/live-org-admin", async original => ({ ...(await original<typeof import("@/lib/live-org-admin")>()), ...api }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => api.orgId ? { session: { currentOrgId: api.orgId } } : null }));
import { LimitRulesLive } from "@/components/admin/limit-rules-live";
import { LimitPolicyTab } from "@/components/admin/limit-policy-tab";
function Language() { const { locale, setLocale } = useI18n(); return <button data-testid="limits-test-language" onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Test language</button>; }
function Locale({ children }: { children: React.ReactNode }) { return <I18nProvider initialLocale="en"><Language />{children}</I18nProvider>; }
const language = () => fireEvent.click(screen.getByTestId("limits-test-language"));
const rawRef = "自定义作用对象 {ref}";
const rule = { ruleId: "rule-raw", scopeKind: "member", scopeRef: rawRef, modelId: null, windowKind: "day", thresholdTokens: 50000, action: "warn", degradeToModelId: null, enabled: true, observedTokens: 12345, usedRatio: 0.247 };
beforeEach(() => { api.orgId = "org-limits-raw"; api.listLimitRules.mockReset().mockResolvedValue({ rules: [rule] }); api.createLimitRule.mockReset().mockResolvedValue({}); api.updateLimitRule.mockReset().mockResolvedValue({}); api.deleteLimitRule.mockReset().mockResolvedValue({}); });
afterEach(() => cleanup());
it("localizes live rule fields and server ratios, preserving authored scope and list selection", async () => {
  render(<LimitRulesLive />, { wrapper: Locale }); const row = await screen.findByTestId("admin-limit-rule-rule-raw");
  expect(row).toHaveTextContent(rawRef); expect(row).toHaveTextContent("All models"); expect(row).toHaveTextContent("Daily"); expect(row).toHaveTextContent("Warn only"); expect(row).toHaveTextContent("50,000");
  expect(screen.getByTestId("admin-limit-rule-used-rule-raw")).toHaveTextContent("Used 12,345 (25%)");
  fireEvent.click(screen.getByTestId("admin-limits-view-toggle-list")); language(); language();
  expect(screen.getByTestId("admin-limit-rules-list")).toBeVisible(); expect(api.listLimitRules).toHaveBeenCalledTimes(1);
});
it("keeps an unmetered agent rule honest instead of displaying a fabricated zero percentage", async () => {
  api.listLimitRules.mockResolvedValue({ rules: [{ ...rule, scopeKind: "agent", scopeRef: "agent-raw", observedTokens: 0, usedRatio: 0 }] });
  render(<LimitRulesLive />, { wrapper: Locale }); const row = await screen.findByTestId("admin-limit-rule-nometric-rule-raw");
  expect(row).toHaveTextContent("This scope has no usage metering yet"); expect(screen.queryByTestId("admin-limit-rule-used-rule-raw")).toBeNull();
  language(); expect(row).toHaveTextContent("本规则当前不会触发"); expect(api.listLimitRules).toHaveBeenCalledTimes(1);
});
it("preserves create fields across languages and sends only canonical scope/window/action IDs", async () => {
  let finish!: (value: unknown) => void; api.createLimitRule.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<LimitRulesLive />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-limit-rule-new"));
  expect(screen.getByTestId("admin-limit-rule-create-modal")).toHaveTextContent("Add limit rule");
  fireEvent.change(screen.getByTestId("admin-limit-scope-kind"), { target: { value: "team" } });
  fireEvent.change(screen.getByTestId("admin-limit-scope-ref"), { target: { value: "  team-raw{ref}  " } });
  fireEvent.change(screen.getByTestId("admin-limit-window"), { target: { value: "hour" } });
  fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "12345.9" } });
  fireEvent.change(screen.getByTestId("admin-limit-action"), { target: { value: "degrade" } });
  fireEvent.change(screen.getByTestId("admin-limit-degrade-to"), { target: { value: "  model-raw{target}  " } });
  language(); language(); expect(screen.getByTestId("admin-limit-threshold")).toHaveValue("12345.9");
  expect(screen.getByTestId("admin-limit-scope-kind")).toHaveValue("team"); expect(screen.getByTestId("admin-limit-action")).toHaveValue("degrade");
  fireEvent.click(screen.getByTestId("admin-limit-rule-create-save")); language(); language();
  expect(api.createLimitRule.mock.calls).toEqual([["org-limits-raw", { scopeKind: "team", scopeRef: "team-raw{ref}", modelId: null, windowKind: "hour", thresholdTokens: 12345, action: "degrade", degradeToModelId: "model-raw{target}" }]]);
  expect(api.listLimitRules).toHaveBeenCalledTimes(1); await act(async () => finish({}));
  await waitFor(() => expect(screen.queryByTestId("admin-limit-rule-create-modal")).toBeNull());
  expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("Limit rule added"); language(); expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("限额规则已新增");
});
it("retranslates validation while preserving invalid input and withholding API writes", async () => {
  render(<LimitRulesLive />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-limit-rule-new"));
  fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "-1" } }); fireEvent.click(screen.getByTestId("admin-limit-rule-create-save"));
  expect(screen.getByTestId("admin-limit-rule-error")).toHaveTextContent("Enter a positive integer threshold"); language(); expect(screen.getByTestId("admin-limit-rule-error")).toHaveTextContent("阈值要是一个正整数");
  expect(screen.getByTestId("admin-limit-threshold")).toHaveValue("-1"); expect(api.createLimitRule).not.toHaveBeenCalled(); language();
  fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "100" } }); fireEvent.click(screen.getByTestId("admin-limit-rule-create-save"));
  expect(screen.getByTestId("admin-limit-rule-error")).toHaveTextContent("Enter a scope target"); expect(api.createLimitRule).not.toHaveBeenCalled();
});
it("explains server degradation-target rejection in the current locale without leaking raw errors", async () => {
  api.createLimitRule.mockRejectedValue(new ApiError(400, "DEGRADE_TARGET_REQUIRED", { message: "private body" }));
  render(<LimitRulesLive />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-limit-rule-new"));
  fireEvent.change(screen.getByTestId("admin-limit-threshold"), { target: { value: "100" } }); fireEvent.change(screen.getByTestId("admin-limit-scope-ref"), { target: { value: rawRef } });
  fireEvent.change(screen.getByTestId("admin-limit-action"), { target: { value: "degrade" } }); fireEvent.click(screen.getByTestId("admin-limit-rule-create-save"));
  const error = await screen.findByTestId("admin-limit-rule-error"); expect(error).toHaveTextContent("Choose a target model for automatic degradation"); language(); expect(error).toHaveTextContent("必须指定降到哪个模型"); language();
  expect(error).not.toHaveTextContent(/DEGRADE_TARGET_REQUIRED|private body/); expect(api.createLimitRule).toHaveBeenCalledTimes(1);
});
it("retains edit drafts and updates only the original threshold field", async () => {
  render(<LimitRulesLive />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-limit-rule-edit-rule-raw"));
  expect(screen.getByTestId("admin-limit-rule-edit-modal")).toHaveTextContent("Edit threshold · " + rawRef);
  fireEvent.change(screen.getByTestId("admin-limit-edit-threshold"), { target: { value: "60000.8" } }); language(); language();
  fireEvent.click(screen.getByTestId("admin-limit-rule-edit-save")); await waitFor(() => expect(api.updateLimitRule.mock.calls).toEqual([["org-limits-raw", "rule-raw", { thresholdTokens: 60000 }]]));
  await waitFor(() => expect(screen.queryByTestId("admin-limit-rule-edit-modal")).toBeNull()); expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("Threshold updated"); language(); expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("阈值已更新");
});
it("retains toggle and delete payloads and explains preserved historical events", async () => {
  render(<LimitRulesLive />, { wrapper: Locale }); const toggle = await screen.findByTestId("admin-limit-rule-toggle-rule-raw");
  expect(toggle).toHaveAccessibleName(rawRef + " rule enabled"); fireEvent.click(toggle);
  await waitFor(() => expect(api.updateLimitRule.mock.calls).toEqual([["org-limits-raw", "rule-raw", { enabled: false }]]));
  fireEvent.click(screen.getByTestId("admin-limit-rule-delete-rule-raw")); await waitFor(() => expect(api.deleteLimitRule.mock.calls).toEqual([["org-limits-raw", "rule-raw"]]));
  await waitFor(() => expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("Rule deleted; historical events are retained")); language(); expect(screen.getByTestId("admin-limit-rules-toast")).toHaveTextContent("历史事件保留");
});
it("shows safe localized read errors and empty rules without treating locale as a reload", async () => {
  api.listLimitRules.mockRejectedValue(new ApiError(403, "FORBIDDEN", { message: "private body" })); render(<LimitRulesLive />, { wrapper: Locale });
  const error = await screen.findByTestId("admin-limit-rules-failed"); expect(error).toHaveTextContent("Could not load limit rules"); expect(error).not.toHaveTextContent(/FORBIDDEN|private body/); language(); language(); expect(api.listLimitRules).toHaveBeenCalledTimes(1);
  api.listLimitRules.mockResolvedValue({ rules: [] }); fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
  expect(await screen.findByTestId("admin-limit-rules-empty")).toHaveTextContent("No limit rules have been configured");
});
it("translates prototype policy explanations while retaining sample data and truthful no-backend behavior", async () => {
  render(<LimitPolicyTab />, { wrapper: Locale }); await screen.findByTestId("admin-limit-rules-live");
  expect(screen.getByTestId("admin-degrade-tiers")).toHaveTextContent("Degradation thresholds"); expect(screen.getByTestId("admin-degrade-tier-org")).toHaveTextContent("90%"); expect(screen.getByTestId("admin-degrade-tier-org")).toHaveTextContent("sonnet-4.6");
  expect(screen.getByTestId("admin-degrade-task-generic")).toHaveTextContent("General generation"); expect(screen.getByTestId("admin-degrade-task-confidential")).toHaveTextContent("Do not degrade");
  expect(screen.getByTestId("admin-limits-tab")).toHaveTextContent(/static demo|demonstration/i);
  fireEvent.click(within(screen.getByTestId("admin-degrade-tier-org")).getByRole("switch")); expect(screen.getByTestId("admin-limits-toast")).toHaveTextContent("Organization degradation threshold is enabled");
  language(); expect(screen.getByTestId("admin-limits-toast")).toHaveTextContent("组织级降级阈值已启用");
  expect(api.createLimitRule).not.toHaveBeenCalled(); expect(api.updateLimitRule).not.toHaveBeenCalled(); expect(api.deleteLimitRule).not.toHaveBeenCalled(); expect(api.listLimitRules).toHaveBeenCalledTimes(1);
});
