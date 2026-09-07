import { expect, test } from "@playwright/test";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

// The existing scroll fixture reveals ten real tool callback pairs over successive
// status polls. It does not run Python's live-poll middleware: this test proves
// durable receipt and uninterrupted execution, not model adoption of the new intent.
test("running composer accepts direction without cancelling the active tool or starting another run", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const runPosts: string[] = [], cancelPosts: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    if (/\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(request.url())) runPosts.push(request.url());
    if (/\/agent-runs\/[^/]+\/cancel(?:\?|$)/.test(request.url())) cancelPosts.push(request.url());
  });
  const input = page.getByTestId("copilotkit-v2-input");
  await input.fill(CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(response.url()));
  await page.getByTestId("copilotkit-v2-send").click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const panel = page.getByTestId("run-trace-panel").last();
  await expect(panel).toHaveAttribute("data-run-id", /.+/);
  const runId = (await panel.getAttribute("data-run-id"))!;
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };
  const journalUrl = `/agent-runs/${runId}/execution-events?afterSeq=-1`;
  const readJournal = async (): Promise<ExecutionEvent[]> => {
    const result = await page.request.get(journalUrl, { headers });
    expect(result.ok()).toBe(true);
    return (await result.json()).events;
  };
  await input.fill("后续整理请突出 B 方向，保留当前步骤的执行结果");
  let activeToolId: string | undefined;
  await expect.poll(async () => {
    const events = await readJournal();
    const ended = new Set(events.filter(event => event.kind === "tool_end").map(event => event.toolCallId));
    const active = events.find(event => event.kind === "tool_start" && !ended.has(event.toolCallId));
    activeToolId = active?.kind === "tool_start" ? active.toolCallId : undefined;
    return Boolean(activeToolId);
  }, { timeout: 30_000, intervals: [100] }).toBe(true);
  await expect(input).toBeEnabled();
  await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled();
  const receiptResponse = page.waitForResponse(value => value.request().method() === "POST" && value.url().includes(`/agent-runs/${runId}/interject`));
  await page.getByTestId("copilotkit-v2-send").click();
  const accepted = await receiptResponse;
  expect(accepted.ok()).toBe(true);
  expect(accepted.request().postDataJSON()).toEqual({text:"后续整理请突出 B 方向，保留当前步骤的执行结果"});
  const receipt = await accepted.json() as {interjectionId: string};
  expect(receipt.interjectionId).toEqual(expect.any(String));
  await expect(input).toHaveValue("");
  await response.finished();
  const events = await readJournal();
  const received = events.find(event => event.kind === "interjection" && event.interjectionId === receipt.interjectionId && event.status === "received");
  expect(received).toBeDefined();
  expect(events.some(event => event.kind === "tool_end" && event.toolCallId === activeToolId && event.ok && event.seq > received!.seq)).toBe(true);
  expect(events.some(event => event.kind === "status" && event.status === "succeeded")).toBe(true);
  expect(events.some(event => event.kind === "status" && event.status === "cancelled")).toBe(false);
  expect(new Set(events.map(event => event.runId))).toEqual(new Set([runId]));
  expect(runPosts).toHaveLength(1);
  expect(cancelPosts).toHaveLength(0);
  await testInfo.attach("steering-journal", {body:JSON.stringify(events,null,2),contentType:"application/json"});
});
