import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { wave2Runtime, planPermissions } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RestoredRunApproval } from "@/components/chat/workbench/restored-run-approval";
const { read, request } = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/agent-run", async original => ({ ...(await original<typeof import("@/lib/agent-run")>()), getAgentRun: read }));
vi.mock("@/lib/api-client", async original => ({ ...(await original<typeof import("@/lib/api-client")>()), apiRequest: request }));
const runId = "raw-run"; const permissionRequestId = "10000000-0000-4000-8000-000000000001";
const rawArgs = '{"skill_stable_name":"用户技能 {count}","task":"用户原始目标 🌍"}';
function runView(pending: boolean) {
  return wave2Runtime.AgentRunView.parse({
    runId, threadId: "raw-thread", inputMessageId: "raw-input", agentId: "raw-agent", agentVersionId: "raw-agent-version", skillVersionIds: ["raw-skill-version"],
    modelProvider: "controlled-fixture", modelId: "controlled-model", status: pending ? "awaiting_tool_permission" : "running", error: null, resultMessageId: null,
    steps: [], createdAt: "2026-11-04T00:00:00Z", pendingApproval: pending ? { permissionRequestId, toolName: "call_skill", argsSummary: rawArgs } : null,
    permissionDecisions: { count: 1, last: "run" },
  });
}
let changeLanguage: () => void = () => { throw new Error("locale driver not ready"); };
function LocaleDriver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLanguage = () => setLocale("zh-CN"); }, [setLocale]); return null; }
beforeEach(() => { read.mockReset(); request.mockReset(); });
it("keeps a restored permission's raw args and exact once decision while locale changes during its POST", async () => {
  let approved = false;
  let resolveDecision: (value: unknown) => void = () => { throw new Error("decision not started"); };
  read.mockImplementation(async () => runView(!approved));
  request.mockImplementation(() => new Promise(resolve => { resolveDecision = value => { approved = true; resolve(value); }; }));
  render(<I18nProvider initialLocale="en"><LocaleDriver /><RestoredRunApproval runId={runId} bearer="unit-fixture-bearer" /></I18nProvider>);
  const dialog = await screen.findByRole("dialog", { name: "Approve high-risk operation" });
  expect(screen.getByTestId("perm-repeat-notice").textContent).toContain("another tool");
  const command = screen.getByTestId("perm-command"); expect(command.textContent).toBe(rawArgs);
  const once = screen.getByRole("button", { name: "Allow once" }); const reads = read.mock.calls.length;
  fireEvent.click(once); fireEvent.click(once);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(`/agent-runs/${runId}/permission-requests/${permissionRequestId}/decision`, { method: "POST", body: { decision: "once" }, sessionToken: "unit-fixture-bearer" });
  act(() => changeLanguage());
  expect(screen.getByRole("dialog", { name: "审批高风险操作" })).toBe(dialog); expect(screen.getByTestId("perm-command")).toBe(command); expect(command.textContent).toBe(rawArgs);
  expect(read).toHaveBeenCalledTimes(reads); expect(request).toHaveBeenCalledTimes(1);
  await act(async () => resolveDecision(planPermissions.operations.decidePermissionRequest.out.parse({ runId, permissionRequestId })));
  await waitFor(() => expect(screen.queryByTestId("restored-run-approval")).toBeNull());
  expect(request).toHaveBeenCalledTimes(1);
});
it("keeps restored observer controls disabled across locale changes without a decision POST", async () => {
  read.mockResolvedValue(runView(true));
  render(<I18nProvider initialLocale="en"><LocaleDriver /><RestoredRunApproval runId={runId} bearer="unit-fixture-bearer" canWrite={false} /></I18nProvider>);
  const once = await screen.findByRole("button", { name: "Allow once" }); expect(once).toBeDisabled();
  fireEvent.click(once); act(() => changeLanguage());
  expect(screen.getByRole("button", { name: "仅本次允许" })).toBe(once); expect(once).toBeDisabled(); expect(request).not.toHaveBeenCalled();
});
