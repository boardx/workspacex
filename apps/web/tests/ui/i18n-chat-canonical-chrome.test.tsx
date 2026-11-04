import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { PlanLedgerView } from "@/lib/plan-control-api";

const ports = vi.hoisted(() => ({
  getApproval: vi.fn(), setApproval: vi.fn(), overview: vi.fn(),
  fetchPlanLedger: vi.fn(), reorderPlanStep: vi.fn(), deletePlanStep: vi.fn(),
  addPlanConstraint: vi.fn(), removePlanConstraint: vi.fn(), confirmPlan: vi.fn(),
  confirmProposedPlan: vi.fn(), pausePlanRun: vi.fn(), resumePlanRun: vi.fn(), retryPlanStep: vi.fn(),
  planControlErrorCode: vi.fn((): string | null => null),
}));
vi.mock("@/lib/document-generation-auto-approve", () => ({
  getDocumentGenerationAutoApprove: ports.getApproval,
  setDocumentGenerationAutoApprove: ports.setApproval,
}));
vi.mock("@/lib/live-projects", () => ({ getProjectOverview: ports.overview }));
vi.mock("@/lib/plan-control-api", () => ports);

import { DocumentGenerationAutoApproveToggle } from "@/components/chat/document-generation-auto-approve-toggle";
import { CopilotKitV2PlanControl, PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID } from "@/components/chat/copilotkit-v2-plan-control";
import { ProjectChatContextBar } from "@/components/chat/project-chat-context-bar";

function LocaleControl() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Change test locale</button>;
}
function host(children: React.ReactNode, initialLocale: "en" | "zh-CN" = "en") {
  return render(<I18nProvider initialLocale={initialLocale}><LocaleControl />{children}</I18nProvider>);
}
beforeEach(() => {
  for (const fn of Object.values(ports)) fn.mockReset();
  ports.planControlErrorCode.mockReturnValue(null);
});
afterEach(cleanup);

it("translates the actual document consent switch without refetching or changing consent", async () => {
  ports.getApproval.mockResolvedValue({ enabled: true });
  host(<DocumentGenerationAutoApproveToggle />);
  const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByRole("switch", { name: "Auto-approve document generation permissions" })).toBe(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Change test locale" }));
  expect(screen.getByRole("switch", { name: "自动批准文档生成所需权限" })).toBe(toggle);
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(ports.getApproval).toHaveBeenCalledTimes(1);
  expect(ports.setApproval).not.toHaveBeenCalled();
});

it("keeps a pending explicit consent write disabled and sends exactly one canonical boolean", async () => {
  ports.getApproval.mockResolvedValue({ enabled: false });
  let finish!: (value: { enabled: boolean }) => void;
  ports.setApproval.mockReturnValue(new Promise<{ enabled: boolean }>(resolve => { finish = resolve; }));
  host(<DocumentGenerationAutoApproveToggle />, "zh-CN");
  const toggle = await screen.findByTestId("chat-document-generation-auto-approve-toggle");
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  expect(ports.setApproval).toHaveBeenCalledTimes(1);
  expect(ports.setApproval).toHaveBeenCalledWith(true);
  expect(toggle).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Change test locale" }));
  expect(screen.getByRole("switch", { name: "Auto-approve document generation permissions" })).toBe(toggle);
  expect(toggle).toBeDisabled();
  expect(ports.getApproval).toHaveBeenCalledTimes(1);
  expect(ports.setApproval).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ enabled: true }); });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(toggle).toHaveAttribute("aria-checked", "true");
});

it("translates the actual canonical collapsed plan with the same raw ledger and polling session", async () => {
  const ledger: PlanLedgerView = {
    cancelRequestedAt: null, pausedAt: null, pauseRequestedAt: null,
    revision: 3, engineEpoch: 1, origin: "engine", stepsAreProposal: false,
    pendingPermissionRequestId: null,
    steps: [
      { planStepId: "raw-1", content: "模型原始步骤 {id} 🌱", status: "completed", constraints: [] },
      { planStepId: "raw-2", content: "原计划未标记步骤", status: "pending", constraints: [] },
    ],
    orphanedConstraints: [], phase: "done", gate: { required: false, reason: "no-plan" },
    progress: { completed: 1, total: 2, elapsedMs: 12000 }, pendingApplyAtNextRun: false,
    runStatus: "idle", activeRunId: null, errorCode: null, failedStepId: null,
  };
  ports.fetchPlanLedger.mockResolvedValue(ledger);
  host(<CopilotKitV2PlanControl threadId="raw-thread" projectId={null} canWrite />);
  const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
  expect(toggle).toHaveTextContent("Execution plan · Run finished · Completed");
  expect(toggle).toHaveAccessibleName("Expand plan panel");
  fireEvent.click(toggle);
  const raw = screen.getByText(ledger.steps[0]!.content);
  fireEvent.click(screen.getByRole("button", { name: "Change test locale" }));
  expect(screen.getByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID)).toBe(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText(ledger.steps[0]!.content)).toBe(raw);
  expect(ports.fetchPlanLedger).toHaveBeenCalledTimes(1);
  expect(ports.fetchPlanLedger).toHaveBeenCalledWith("raw-thread", null);
  expect(ports.confirmPlan).not.toHaveBeenCalled();
  expect(ports.confirmProposedPlan).not.toHaveBeenCalled();
});

it("localizes project context chrome while retaining the raw name, href and loaded DOM", async () => {
  ports.overview.mockResolvedValue({ id: "raw/project", name: "组织项目 {name} 原文", kind: "general" });
  host(<ProjectChatContextBar projectId="raw/project" orgId="raw org" bearer="test-only-port" />);
  const name = await screen.findByText("组织项目 {name} 原文");
  const back = screen.getByTestId("project-chat-back");
  expect(back).toHaveTextContent("Back to project");
  expect(screen.getByTestId("project-chat-context-bar")).toHaveAccessibleName("Project context");
  expect(back).toHaveAttribute("href", "/projects/raw%2Fproject?org=raw%20org&tab=content");
  fireEvent.click(screen.getByRole("button", { name: "Change test locale" }));
  expect(screen.getByText("组织项目 {name} 原文")).toBe(name);
  expect(screen.getByTestId("project-chat-back")).toBe(back);
  expect(back).toHaveTextContent("返回项目");
  expect(ports.overview).toHaveBeenCalledTimes(1);
  expect(ports.overview).toHaveBeenCalledWith("raw/project");
});

it("localizes the owned unknown-project fallback without inventing a project name or fetching on locale", async () => {
  ports.overview.mockReturnValue(new Promise(() => {}));
  host(<ProjectChatContextBar projectId="raw-project" orgId={null} bearer="test-only-port" />);
  expect(screen.getByTestId("project-chat-name")).toHaveTextContent("Project conversation");
  const back = screen.getByTestId("project-chat-back");
  expect(back).toHaveAttribute("href", "/projects/raw-project?tab=content");
  fireEvent.click(screen.getByRole("button", { name: "Change test locale" }));
  expect(screen.getByTestId("project-chat-name")).toHaveTextContent("项目对话");
  expect(ports.overview).toHaveBeenCalledTimes(1);
});
