import { expect, test } from "@playwright/test";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { findSteeringExecutionViolations } from "./support/steering-execution-evidence";
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
  // issue #3312 —— 这里原本用 `expect.poll` 抓「有 tool_start 尚无 tool_end」的那一件当
  // `activeToolId`，再断言它必须在插话之后收尾。那是**锚错了对象**：十对工具跑得比一次
  // POST 往返还快，抓到的那件常在插话落地之前就已 ok=true 收尾，判据于是恒假——产品行为
  // 完全正确时也会红，红不红只取决于 interject 的 POST 落在第几对工具之间（本地相位固定
  // ⇒ 稳定红，CI 各车道相位不同 ⇒ 此前一直绿）。
  //
  // 现在只等「执行确实已经开始」这一件事（这是插话有意义的前提），真正的判据搬到下面的
  // `findSteeringExecutionViolations`，锚在真实业务语义上、不依赖快照相位。
  let lastJournalNote = "journal never read";
  await expect.poll(async () => {
    const events = await readJournal();
    const kinds = events.reduce<Record<string, number>>((acc, event) => ({ ...acc, [event.kind]: (acc[event.kind] ?? 0) + 1 }), {});
    lastJournalNote = `events=${String(events.length)} kinds=${JSON.stringify(kinds)}`;
    return events.some(event => event.kind === "tool_start");
  }, { timeout: 30_000, intervals: [100] }).toBe(true).catch((error: unknown) => {
    throw new Error(`30s 内一个 tool_start 都没出现（run 可能压根没被 executor 领走）；最后一次日志观测：${lastJournalNote}\n${String(error)}`);
  });
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
  // issue #3312 —— 判据锚在真实业务语义：插话之后仍有工具**成对**完成、没有任何工具被打断
  // （悬空或 ok=false）、全程无 cancelled、只有一条 run。反证夹具在
  // `apps/web/tests/e2e-support/steering-execution-evidence.test.ts`，四条判据各有一个会红的缺陷形状。
  expect(findSteeringExecutionViolations({ events, runId, receivedSeq: received!.seq })).toEqual([]);
  expect(events.some(event => event.kind === "status" && event.status === "succeeded")).toBe(true);
  expect(runPosts).toHaveLength(1);
  expect(cancelPosts).toHaveLength(0);
  await testInfo.attach("steering-journal", {body:JSON.stringify(events,null,2),contentType:"application/json"});
});
