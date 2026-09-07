import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";
import type { PlanLedgerView } from "@/lib/plan-control-api";

test.setTimeout(150_000);

test("real streaming chat uses a collapsed butterfly trace without a duplicate progress card", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(response.url()));
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const trace = page.getByTestId("run-trace-panel").last();
  await expect(trace.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
  const butterfly = trace.getByTestId("copilotkit-v2-thinking-mark");
  await expect(butterfly).toBeVisible();
  expect(await butterfly.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await expect(page.getByTestId("copilotkit-v2-thinking-stage")).toHaveCount(0);
  await trace.getByTestId("run-trace-toggle").click();
  await expect(trace.getByTestId("run-trace-entry").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-streaming-expanded.png"), fullPage: true });
  await response.finished();
  const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  expect(events.some(event => event.type === "RUN_ERROR")).toBe(false);
  expect(events.some(event => event.type === "RUN_FINISHED")).toBe(true);
  await expect(butterfly).toHaveCount(0);
});

// The actual chat component and polling hook run; only ledger HTTP responses are controlled.
// This verifies presentation and resume reachability, not backend checkpoint execution.
test("mobile plan is absent without steps and compact/collapsible with steps; paused controls remain reachable", async ({ page }, testInfo) => {
  let ledger: PlanLedgerView = { revision: 1, engineEpoch: 1, origin: "engine", steps: [], orphanedConstraints: [],
    phase: "preparing", gate: { required: false, reason: "no-plan" }, progress: { completed: 0, total: 0, elapsedMs: 0 },
    pendingApplyAtNextRun: false, activeRunId: null, errorCode: null, failedStepId: null,
    cancelRequestedAt: null, pausedAt: null, pauseRequestedAt: null };
  await page.route(/\/plan-control\/threads\/[^/]+\/ledger(?:\?|$)/, route => route.fulfill({ json: ledger }));
  await openFreshThread(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("chat-task-workbench-plan-control")).toHaveCount(0);
  ledger = { ...ledger, phase: "executing", activeRunId: "ui-plan-run", pausedAt: "2026-09-07T00:00:00Z",
    steps: [{ planStepId: "ui-step", content: "检查真实计划布局", status: "in_progress", constraints: [] }],
    progress: { completed: 0, total: 1, elapsedMs: 1000 } };
  await page.reload();
  const toggle = page.getByTestId("chat-task-workbench-plan-collapse-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("chat-task-workbench-run-resume")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("chat-task-workbench-plan-step")).toContainText("检查真实计划布局");
  await expect(page.getByTestId("copilotkit-v2-input")).toBeInViewport();
  await expect(page.getByTestId("chat-task-workbench-run-resume")).toBeInViewport();
  await expect(page.getByTestId("chat-task-workbench-run-resume")).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("mobile-plan-expanded.png"), fullPage: true });
  await expect(page.getByTestId("chat-task-workbench-run-resume")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("chat-task-workbench-plan-step")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// Real chat/run fixture; the confirmation payload and decision transport are controlled
// HTTP boundaries. This proves dialog wiring, not kernel confirm-task execution.
test("persisted confirmation opens, closes without deciding, reopens and submits once", async ({ page }) => {
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  let runUrl = "";
  let requestId = "";
  let decided = false;
  const decisions: unknown[] = [];
  await page.route(/\/agent-runs\/[^/?]+(?:\?|$)/, async route => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    if (body.status === "awaiting_tool_permission" && body.pendingApproval?.permissionRequestId) {
      runUrl = route.request().url(); requestId = body.pendingApproval.permissionRequestId;
      if (decided) { body.status = "cancelled"; body.pendingApproval = null; }
      else body.pendingApproval.interrupt = { toolName: "confirm_task_intent", args: {
        requestId: "ui-confirm-request", understanding: "确认本次任务的目标", assumptions: [],
      } };
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/agent-runs\/[^/]+\/decision(?:\?|$)/, async route => {
    decisions.push(route.request().postDataJSON()); decided = true;
    await route.fulfill({ status: 200, json: {} });
  });
  try {
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentApprovalTrigger);
    await page.getByTestId("copilotkit-v2-send").click();
    const dialog = page.getByRole("dialog", { name: "确认任务意图" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("确认本次任务的目标");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(decisions).toEqual([]);
    await page.getByRole("button", { name: "打开待确认请求" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "继续", exact: true }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions).toEqual([{ permissionRequestId: requestId, decision: "approve" }]);
    await expect(dialog).toHaveCount(0);
  } finally {
    if (runUrl) {
      const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
      const cleanup = await page.request.post(`${runUrl}/cancel`, { headers: { Authorization: `Bearer ${token}` } });
      expect(cleanup.ok()).toBe(true);
    }
  }
});
