import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chat } from "@repo/contracts";
import { AidtContextReceipt, AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { bearerOf, sendViaWorkbench } from "./chat-v2-send";

const composer = (page: Page) => page.getByTestId("copilotkit-v2-input");

async function openInterview(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok()).toBe(true);
  await expect(composer(page)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
  return new URL(page.url()).searchParams.get("thread")!;
}

test("ten interviews bind to ten native conversations and reopening never copies sibling state", async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill("十个独立访谈 " + randomUUID().slice(0, 8));
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const pathname = new URL(page.url()).pathname;
  const ids = Array.from({ length: 10 }, () => randomUUID());
  const fields = Object.fromEntries(ids.map((id, index) => {
    const code = "U" + (index + 1).toString().padStart(2, "0");
    return ["interviewRecord:" + id, JSON.stringify({
      version: 1, id, code, topicRevision: null, topic: "", goal: "", original: "",
      adopted: index ? code + " 的测试清单" : "", guideConfirmed: false, consent: null,
    })];
  }));
  const saved = await page.evaluate(async ({ path, fields, operationId }) => {
    const response = await fetch("/__fullstack_api/projects/" + path.split("/").pop() + "/aidt/stages/2", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("wsx.sessionToken") },
      body: JSON.stringify({ operationId, expectedRevision: 0, sourceStageRevisions: [],
        content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: "" } } }),
    });
    return response.status;
  }, { path: pathname, fields, operationId: randomUUID() });
  expect(saved).toBe(200);
  const listing = pathname + "?step=2";
  const urls = ids.map(id => listing + "&entity=" + id);
  await page.goto(listing);
  await expect(composer(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /U01/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /U10/ })).toBeVisible();

  const secondTab = await context.newPage();
  const [first, duplicate] = await Promise.all([openInterview(page, urls[0]!), openInterview(secondTab, urls[0]!)]);
  expect(duplicate).toBe(first);
  await page.goto(urls[0]! + "&tool=outcome");
  const inspector = page.getByTestId("aidt-tool-panel");
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "访谈问题清单" })).toBeVisible();
  await expect(inspector.getByRole("textbox", { name: "学生提纲原稿" })).toHaveCount(0);
  await expect(page.getByTestId("aidt-chat-welcome")).toContainText("你准备问这位受访者哪些问题");
  await page.screenshot({ path: test.info().outputPath("interview-chat-start.png") });
  await expect(inspector.getByTestId("aidt-interview-output")).toContainText("U01 · 访谈产物");
  await expect(inspector.locator("input, textarea, select")).toHaveCount(0);
  await expect(inspector.getByLabel("访谈 / 观察提纲", { exact: true })).toHaveCount(0);
  await page.getByTestId("chat-task-workbench-inspector-collapse").click();
  await expect(inspector).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("entity")).toBe(ids[0]);
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(first);
  const message = "请回忆最近一次挑选新品的经历。当时你看了哪些信息？";
  const run = await sendViaWorkbench(page, message);
  expect(AidtContextSelector.parse(run.postDataJSON().forwardedProps?.aidtContext)).toMatchObject({
    entityId: ids[0], stageId: 2, stageRevisions: [{ stageId: 2, revision: 1 }],
  });
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();

  const bearer = await bearerOf(page);
  const headers = { Authorization: "Bearer " + bearer };
  let runId: string | null | undefined;
  await expect.poll(async () => {
    const response = await page.request.get("/__fullstack_api/chat/threads/" + encodeURIComponent(first) + "/messages?limit=100", { headers });
    expect(response.ok()).toBe(true);
    const { messages } = chat.operations.listMessages.out.parse(await response.json());
    runId = messages.find(row => row.authorKind === "human" && row.text === message)?.agentRunId;
    return runId;
  }).toBeTruthy();
  const receipt = await page.request.get("/__fullstack_api/agent-runs/" + encodeURIComponent(runId!) + "/aidt-context", { headers });
  expect(receipt.ok()).toBe(true);
  expect(AidtContextReceipt.parse(await receipt.json()).stageRevisions).toEqual([{ stageId: 2, revision: 1 }]);

  const threads = [first];
  for (const [index, url] of urls.slice(1).entries()) {
    threads.push(await openInterview(page, url + "&tool=outcome"));
    const code = "U" + (index + 2).toString().padStart(2, "0");
    await expect(page.getByTestId("aidt-interview-question-list")).toContainText(code + " 的测试清单");
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
  }
  expect(new Set(threads).size).toBe(10);
  expect(await openInterview(page, urls[0]!)).toBe(first);
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(first);
  await page.getByRole("link", { name: /返回访谈列表/ }).click();
  await expect(composer(page)).toHaveCount(0);

  const versionsSaved = await page.evaluate(async ({ pathname, firstId, ids }) => {
    const endpoint = "/__fullstack_api/projects/" + pathname.split("/").pop() + "/aidt/stages/";
    const headers = { "content-type": "application/json", authorization: "Bearer " + localStorage.getItem("wsx.sessionToken") };
    const head = await (await fetch(endpoint + "2", { headers })).json();
    const original = JSON.parse(head.stage.content.draft.fields["interviewRecord:" + firstId]);
    const nextFields = { ...head.stage.content.draft.fields, ["interviewRecord:" + firstId]: JSON.stringify({ ...original, code: "U01 最新标题", original: "你怎样选新品？", adopted: "上次看了什么？" }) };
    const next = await fetch(endpoint + "2", { method: "PUT", headers, body: JSON.stringify({
      operationId: ids[0], expectedRevision: head.stage.revision, sourceStageRevisions: [],
      content: { schemaVersion: 1, draft: { fields: nextFields, ideas: [], selectedIdeaId: "" } },
    }) });
    const saveReport = (expectedRevision: number, confirmedAtRevision?: number) => fetch(endpoint + "6", {
      method: "PUT", headers, body: JSON.stringify({
        operationId: ids[expectedRevision + 1], expectedRevision, sourceStageRevisions: [],
        content: { schemaVersion: 1, draft: { fields: {}, ideas: [], selectedIdeaId: "" },
          summaryReport: { markdown: "# 访谈回顾", sourceStageRevisions: [{ stageId: 2, revision: 1 }], confirmedAtRevision } },
      }),
    });
    const draft = await saveReport(0);
    const confirmed = await saveReport(1, 2);
    return [next.status, draft.status, confirmed.status];
  }, { pathname, firstId: ids[0]!, ids: [randomUUID(), randomUUID(), randomUUID()] });
  expect(versionsSaved).toEqual([200, 200, 200]);
  await page.goto(pathname + "?step=6&summary=1&entity=group-report&tool=report");
  const reports = page.getByTestId("aidt-report-versions");
  await reports.getByText("已确认版本与导出", { exact: true }).click();
  await reports.getByRole("button", { name: "查看确认版 V2" }).click();
  await reports.getByRole("button", { name: "查看第 2 步 V1" }).click();
  await reports.getByRole("link", { name: "U01 · V1" }).click();
  await expect(page.getByTestId("aidt-entity-history")).toBeVisible();
  await expect(page).toHaveURL(new RegExp("entity=" + ids[0] + ".*entityRevision=1"));
  await expect(page.getByTestId("aidt-interview-output")).toContainText("U01 · 访谈产物");

  await page.goto(urls[0]! + "&tool=outcome");
  const actions = page.getByTestId("aidt-interview-chat-actions");
  await expect(actions).toBeVisible();
  await actions.getByRole("button", { name: "编辑这道问题" }).click();
  const question = "你上一次选新品时，哪一条信息影响了决定？";
  await actions.getByLabel("修改问题").fill(question);
  await actions.getByRole("button", { name: "确认这份问题清单" }).click();
  await expect(page.getByTestId("aidt-interview-save-state")).toHaveText("已保存");
  await expect(page.getByTestId("aidt-interview-question-list")).toContainText(question);
  await page.reload();
  await expect(page.getByText(question, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("interview-chat-confirmed.png") });
  await openInterview(page, urls[1]! + "&tool=outcome");
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
});

test.describe("recording evidence in the interview Chat", () => {
  test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    ...(process.env.AIDT_RECORDING_TEST_WAV ? ["--use-file-for-fake-audio-capture=" + process.env.AIDT_RECORDING_TEST_WAV] : [])] } });

  test("a saved WAV and a checked excerpt become a sourced finding without entering the outcome form", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
    await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/home$/);
    await page.getByTestId("rail-aidt").click();
    await page.getByTestId("aidt-new").click();
    await page.getByTestId("project-new-name").fill("合成录音到发现卡 " + randomUUID().slice(0, 8));
    await page.getByTestId("project-new-create").click();
    await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
    const path = new URL(page.url()).pathname, projectId = path.split("/").pop()!;
    const first = randomUUID(), sibling = randomUUID();
    const fields = Object.fromEntries([first, sibling].map((id, index) => ["interviewRecord:" + id,
      JSON.stringify({ version: 1, id, code: "U0" + (index + 1), topicRevision: 1, topic: "合成音源验收", goal: "了解选择",
        original: "怎么选饮料？", adopted: "上次怎么选的？", guideConfirmed: true,
        consent: { notes: true, photos: false, audio: true, capture: true, asr: false, observedAt: new Date().toISOString() } })]));
    const headers = { Authorization: "Bearer " + await bearerOf(page) };
    const endpoint = "/__fullstack_api/projects/" + projectId + "/aidt/stages/2";
    expect((await page.request.put(endpoint, { headers, data: { operationId: randomUUID(), expectedRevision: 0,
      sourceStageRevisions: [], content: { schemaVersion: 1, draft: { fields, selectedIdeaId: "", ideas: [] } } } })).ok()).toBe(true);
    const url = path + "?step=2&entity=" + first + "&tool=outcome";
    await openInterview(page, url);
    const materials = () => page.getByTestId("chat-task-workbench-inspector-tab-materials").click();
    await materials();
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByRole("button", { name: "停止录音" })).toBeVisible();
    // Keep the capture open long enough to contain the synthetic spoken sample.
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1800)));
    await page.getByRole("button", { name: "停止录音" }).click();
    await expect(page.locator("audio").first()).toBeAttached();
    await page.getByRole("button", { name: "保存本次录音原件" }).click();
    const head = async () => (await (await page.request.get(endpoint, { headers })).json()).stage.content.draft;
    await expect.poll(async () => Object.keys((await head()).fields).some(key => key.startsWith("captured:interviewMaterial:" + first + ":"))).toBe(true);
    await page.reload();
    await materials();
    const select = page.getByLabel("转写原件", { exact: true });
    await expect(select.locator("option")).toHaveCount(2);
    await select.selectOption({ index: 1 });
    await page.getByLabel("定位（如 01:42 或第 3 段）").fill("00:01");
    await page.getByLabel("校对后的摘录").fill("我先看口味");
    await page.getByLabel("已对照原始材料校对").check();
    await expect.poll(async () => JSON.parse((await head()).fields["interviewTranscript:" + first] || "{}").checked).toBe(true);
    await sendViaWorkbench(page, "合成访谈验收：她在菜单前比较口味。请整理本次发现。");
    await expect.poll(async () => (await head()).discoveryCards?.[0]?.sourceRef, { timeout: 60_000 }).toContain("00:01");
    await page.goto(url);
    const output = page.getByTestId("aidt-interview-finding");
    await output.getByText("发现详情与来源").click();
    await expect(output).toContainText("她在菜单前比较口味");
    await expect(output).toContainText("我先看口味");
    await expect(output).toContainText("00:01");
    await expect(output.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("sourced-recording-finding.png") });
    await openInterview(page, path + "?step=2&entity=" + sibling + "&tool=outcome");
    await expect(page.getByTestId("aidt-interview-finding")).not.toContainText("我先看口味");
  });
});
