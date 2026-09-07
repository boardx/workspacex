import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

test.setTimeout(180_000);

type RunView = {
  runId: string;
  status: string;
  resultMessageId: string | null;
};

type JournalEvent = {
  kind: string;
  status?: string;
  toolName?: string;
  toolCallId?: string;
};

type PendingRun = RunView & {
  pendingApproval: {
    permissionRequestId: string;
    toolName: string;
    interrupt?: { toolName: string; args: { requestId: string } };
  } | null;
};

async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token}` };
}

async function triggerFormInterrupt(page: Page, trigger: string, toolName: string) {
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const pendingResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json() as PendingRun;
    return body.status === "awaiting_tool_permission" && body.pendingApproval?.toolName === toolName;
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(trigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await pendingResponse;
  const run = await response.json() as PendingRun;
  expect(run.pendingApproval?.interrupt?.toolName).toBe(toolName);
  return { run, runUrl: response.url(), headers: await sessionHeaders(page) };
}

async function expectRunStatus(
  page: Page,
  runUrl: string,
  headers: Record<string, string>,
  status: string,
): Promise<void> {
  await expect.poll(async () => {
    const response = await page.request.get(runUrl, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json() as RunView).status;
  }, { timeout: 90_000 }).toBe(status);
}

test("复杂任务把 write_todos 持久化为一份计划，完成后只保留折叠执行轨迹", async ({ page }) => {
  const threadId = await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);

  const completedResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json() as RunView;
    return body.status === "succeeded" && body.resultMessageId !== null;
  }, { timeout: 120_000 });

  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await page.getByTestId("copilotkit-v2-send").click();
  const completedHttp = await completedResponse;
  const completed = await completedHttp.json() as RunView;
  const headers = await sessionHeaders(page);
  const apiOrigin = new URL(completedHttp.url()).origin;

  const ledgerResponse = await page.request.get(
    `${apiOrigin}/plan-control/threads/${encodeURIComponent(threadId)}/ledger`,
    { headers },
  );
  expect(ledgerResponse.ok()).toBe(true);
  const ledger = await ledgerResponse.json() as {
    origin: string;
    phase: string;
    steps: Array<{ content: string; status: string }>;
    activeRunId: string | null;
  };
  expect(ledger.origin).toBe("engine");
  expect(ledger.phase).toBe("done");
  expect(ledger.steps.map((step) => step.content)).toEqual([
    "搜索相关文档",
    "读取最相关的一份",
    "综合结论作答",
  ]);
  // Terminal runs deliberately expose no live control identity.
  expect(ledger.activeRunId).toBeNull();

  // The composer-level plan is an action surface only. Completed history belongs to
  // the run trace so the same write_todos snapshot is not rendered twice.
  await expect(page.getByTestId("chat-task-workbench-plan-control")).toHaveCount(0);
  const trace = page.locator(`[data-testid="run-trace-panel"][data-run-id="${completed.runId}"]`);
  await expect(trace).toHaveCount(1);
  await expect(trace.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");

  const journalResponse = await page.request.get(
    `${completedHttp.url()}/execution-events?afterSeq=-1`,
    { headers },
  );
  expect(journalResponse.ok()).toBe(true);
  const events = (await journalResponse.json()).events as JournalEvent[];
  expect(events.filter((event) => event.kind === "status" && event.status === "succeeded")).toHaveLength(1);
  const writeTodosStarts = events.filter(
    (event) => event.kind === "tool_start" && event.toolName === "write_todos",
  );
  expect(writeTodosStarts).toHaveLength(1);
  expect(new Set(events.filter((event) => event.kind === "tool_start").map((event) => event.toolCallId)).size)
    .toBe(events.filter((event) => event.kind === "tool_start").length);

  await trace.getByTestId("run-trace-toggle").click();
  await expect(trace.getByTestId("run-trace-entry").first()).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-tool-write-todos")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("copilotkit-v2-tool-write-todos")).toHaveCount(0);
  await expect(page.locator(`[data-testid="run-trace-panel"][data-run-id="${completed.runId}"]`)).toHaveCount(1);
  await expect(page.getByTestId("chat-task-workbench-plan-control")).toHaveCount(0);
});

test("confirm_task_intent 支持修改假设并恢复同一个 run", async ({ page }) => {
  const { run, runUrl, headers } = await triggerFormInterrupt(
    page,
    CHAT_READ_E2E.deepAgentConfirmIntentTrigger,
    "confirm_task_intent",
  );
  const dialog = page.getByRole("dialog", { name: "确认任务意图" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByTestId("agent-interrupt-confirm-intent-understanding")).toContainText("团队评审");
  await dialog.getByTestId("agent-interrupt-confirm-intent-edit-toggle").click();
  const assumption = dialog.getByTestId("agent-interrupt-confirm-intent-assumption-input-0");
  await assumption.fill("只使用当前会话中已确认的信息");
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${run.runId}/decision`));
  await dialog.getByTestId("agent-interrupt-confirm-intent-edit-submit").click();
  const decision = await decisionResponse;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON()).toEqual({
    permissionRequestId: run.pendingApproval!.permissionRequestId,
    decision: "edit",
    editedArgs: { assumptions: ["只使用当前会话中已确认的信息"] },
  });
  await expectRunStatus(page, runUrl, headers, "succeeded");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("只使用当前会话中已确认的信息");
});

test("confirm_task_intent 继续操作只提交一次；旧请求不能重复裁决", async ({ page }) => {
  const { run, runUrl, headers } = await triggerFormInterrupt(
    page,
    CHAT_READ_E2E.deepAgentConfirmIntentTrigger,
    "confirm_task_intent",
  );
  const dialog = page.getByRole("dialog", { name: "确认任务意图" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${run.runId}/decision`));
  await dialog.getByTestId("agent-interrupt-confirm-intent-continue").click();
  const decision = await decisionResponse;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON()).toEqual({
    permissionRequestId: run.pendingApproval!.permissionRequestId,
    decision: "approve",
  });
  await expectRunStatus(page, runUrl, headers, "succeeded");
  const stale = await page.request.post(`${runUrl}/decision`, {
    headers,
    data: { permissionRequestId: run.pendingApproval!.permissionRequestId, decision: "approve" },
  });
  expect(stale.status()).toBe(409);
  const journal = await page.request.get(`${runUrl}/execution-events?afterSeq=-1`, { headers });
  const events = (await journal.json()).events as JournalEvent[];
  expect(events.filter((event) => event.kind === "status" && event.status === "succeeded")).toHaveLength(1);
});

test("choose_execution_option 按 optionId 选择并从刷新后的同一个请求恢复", async ({ page }) => {
  const { run, runUrl, headers } = await triggerFormInterrupt(
    page,
    CHAT_READ_E2E.deepAgentChooseOptionTrigger,
    "choose_execution_option",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "任务需要你的确认" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const restored = await (await page.request.get(runUrl, { headers })).json() as PendingRun;
  expect(restored.pendingApproval?.permissionRequestId).toBe(run.pendingApproval!.permissionRequestId);
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${run.runId}/decision`));
  await dialog.getByTestId("agent-interrupt-choose-option-option-thorough").click();
  const decision = await decisionResponse;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON()).toEqual({
    permissionRequestId: run.pendingApproval!.permissionRequestId,
    decision: "edit",
    editedArgs: { selectedOptionId: "thorough" },
  });
  await expectRunStatus(page, runUrl, headers, "succeeded");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText("已选择方案：thorough");
});

test("choose_execution_option 都不要会诚实结束为拒绝态", async ({ page }) => {
  const { run, runUrl, headers } = await triggerFormInterrupt(
    page,
    CHAT_READ_E2E.deepAgentChooseOptionTrigger,
    "choose_execution_option",
  );
  const dialog = page.getByRole("dialog", { name: "任务需要你的确认" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${run.runId}/decision`));
  await dialog.getByTestId("agent-interrupt-choose-option-decline").click();
  const decision = await decisionResponse;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON()).toEqual({
    permissionRequestId: run.pendingApproval!.permissionRequestId,
    decision: "reject",
  });
  await expectRunStatus(page, runUrl, headers, "failed");
  const final = await (await page.request.get(runUrl, { headers })).json() as PendingRun & { error?: string | null };
  expect(final.pendingApproval).toBeNull();
  expect(final.error).toBe("HITL_REJECTED");
});
