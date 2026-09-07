import { expect, test, type Page } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

test.setTimeout(180_000);

type PendingRun = {
  runId: string;
  status: string;
  resultMessageId: string | null;
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

test("宽泛 PDF 请求补参后在同一个持久 run 上恢复，并只显示一条执行轨迹与一个产物", async ({ page }) => {
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);

  const pendingResponse = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/agent-runs\/[^/?]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
    const body = await response.json() as PendingRun;
    return body.status === "awaiting_tool_permission" && body.pendingApproval?.toolName === "fill_run_params";
  }, { timeout: 60_000 });
  await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentClarificationTrigger);
  await page.getByTestId("copilotkit-v2-send").click();

  const pendingHttp = await pendingResponse;
  const pending = await pendingHttp.json() as PendingRun;
  const runUrl = pendingHttp.url();
  const headers = await sessionHeaders(page);
  expect(pending.pendingApproval?.interrupt?.toolName).toBe("fill_run_params");
  const permissionRequestId = pending.pendingApproval!.permissionRequestId;

  const dialog = page.getByRole("dialog", { name: "等待你补充信息" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByTestId("agent-interrupt-fill-params-input-topic")).toBeVisible();
  await expect(page.locator(`[data-testid="run-trace-panel"][data-run-id="${pending.runId}"]`)).toHaveCount(1);

  // Refresh must restore the authoritative pending request from Postgres, not create a new run.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const restored = await (await page.request.get(runUrl, { headers })).json() as PendingRun;
  expect(restored.runId).toBe(pending.runId);
  expect(restored.pendingApproval?.permissionRequestId).toBe(permissionRequestId);

  await dialog.getByTestId("agent-interrupt-fill-params-input-topic").fill(CHAT_READ_E2E.deepAgentClarificationTopic);
  await dialog.getByTestId("agent-interrupt-fill-params-input-content_source").fill(CHAT_READ_E2E.deepAgentClarificationContentSource);
  const decisionResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/agent-runs/${pending.runId}/decision`));
  await dialog.getByRole("button", { name: "提交并继续", exact: true }).click();
  const decision = await decisionResponse;
  expect(decision.status()).toBe(200);
  expect(decision.request().postDataJSON()).toMatchObject({ permissionRequestId, decision: "edit" });

  await expect.poll(async () => {
    const response = await page.request.get(runUrl, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json() as PendingRun).status;
  }, { timeout: 90_000 }).toBe("succeeded");

  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(CHAT_READ_E2E.deepAgentClarificationTopic, { timeout: 60_000 });
  const trace = page.locator(`[data-testid="run-trace-panel"][data-run-id="${pending.runId}"]`);
  await expect(trace).toHaveCount(1);
  await expect(trace.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");

  const artifact = page.getByTestId("chat-produced-file-inline-card");
  await expect(artifact).toHaveCount(1, { timeout: 60_000 });
  await expect(artifact).toContainText(CHAT_READ_E2E.deepAgentClarificationArtifactName);
  const download = artifact.getByTestId("chat-produced-file-inline-download");
  await expect(download).toHaveAttribute("href", /\S+/);
  const href = await download.getAttribute("href");
  const signature = await page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    return new TextDecoder("ascii").decode((await response.arrayBuffer()).slice(0, 5));
  }, href!);
  expect(signature).toBe("%PDF-");

  const journal = await page.request.get(`${runUrl}/execution-events?afterSeq=-1`, { headers });
  expect(journal.ok()).toBe(true);
  const events = (await journal.json()).events as Array<{ kind: string; status?: string; toolName?: string; toolCallId?: string }>;
  expect(events.filter((event) => event.kind === "status" && event.status === "succeeded")).toHaveLength(1);
  expect(events.some((event) => event.kind === "status" && event.status === "failed")).toBe(false);
  expect(events.filter((event) => event.kind === "tool_start" && event.toolName === "fill_run_params")).toHaveLength(1);
  expect(events.filter((event) => event.kind === "tool_start" && event.toolName === "call_skill")).toHaveLength(1);
  const toolStarts = events.filter((event) => event.kind === "tool_start").map((event) => event.toolCallId);
  expect(new Set(toolStarts).size).toBe(toolStarts.length);
});
