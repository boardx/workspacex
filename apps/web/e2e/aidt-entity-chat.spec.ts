import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { chat } from "@repo/contracts";
import { AidtContextReceipt, AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { confirmAidtIdeaFromChat } from "../features/aidt/lib/aidt-idea-chat";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, confirmAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "../features/aidt/lib/aidt-idea-classification";
import { readAidtIdeaHandoff } from "../features/aidt/lib/aidt-idea-handoff";
import { readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { createAidtBrainstorm, addAidtBrainstormCandidates, confirmAidtBrainstormSelection, aidtBrainstormRoundClassificationDraft, confirmAidtBrainstormClassification, confirmAidtBrainstormCompletion, readAidtConfirmedBrainstormRounds } from "../features/aidt/lib/aidt-brainstorm";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { bearerOf, sendViaWorkbench } from "./chat-v2-send";

test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    ...(process.env.AIDT_RECORDING_TEST_WAV ? ["--use-file-for-fake-audio-capture=" + process.env.AIDT_RECORDING_TEST_WAV] : [])] } });

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
  const problemId=randomUUID();
  const sourceProject=pathname.split("/").pop()!;
  const upstreamQuestion="新手司机夜间如何确认施工区车道？";
  const head=await page.request.put("/__fullstack_api/projects/"+sourceProject+"/aidt/stages/1",{
    headers:{Authorization:"Bearer "+await bearerOf(page)},
    data:{operationId:randomUUID(),expectedRevision:0,sourceStageRevisions:[],content:{schemaVersion:1,draft:{
      fields:{problemHandoffEntity:problemId,["problemEntity:"+problemId]:JSON.stringify({id:problemId,title:"高速施工区",archived:false}),
        ["problemDraft:"+problemId]:JSON.stringify({initial:upstreamQuestion,scene:"夜间高速",rewrittenTheme:upstreamQuestion})},ideas:[],selectedIdeaId:""}}}
  });
  expect(head.ok()).toBe(true);
  const fields = Object.fromEntries(ids.map((id, index) => {
    const code = "U" + (index + 1).toString().padStart(2, "0");
    return ["interviewRecord:" + id, JSON.stringify({
      version: 1, id, code, topicRevision: index===0 ? 1 : null, topic: "", goal: "", original: "",
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

  const parsed=AidtContextReceipt.parse(await receipt.json());
  expect(parsed.entityReferences).toContainEqual({stageId:1,revision:1,entityId:problemId});
  const sourceTab=await context.newPage();
  await sourceTab.goto(pathname+"?step=1&entity="+problemId+"&entityRevision=1");
  await expect(sourceTab.getByTestId("aidt-entity-history")).toContainText(upstreamQuestion);
  await sourceTab.getByRole("link",{name:"查看此产物的对话"}).click();
  await expect(composer(sourceTab)).toBeVisible();
  await sourceTab.close();

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

  const reconcileUrl = new RegExp("/aidt/stages/2/entities/" + ids[0] + "/reconcile$");
  const unrelatedStageUrl = /\/aidt\/stages\/1$/;
  let releaseReconcile!: () => void;
  const reconcileGate = new Promise<void>(resolve => { releaseReconcile = resolve; });
  let releaseUnrelatedStage!: () => void;
  const unrelatedStageGate = new Promise<void>(resolve => { releaseUnrelatedStage = resolve; });
  let reconciling = false;
  await page.route(reconcileUrl, async route => {
    await reconcileGate;
    reconciling = true;
    await route.continue();
  });
  await page.route(unrelatedStageUrl, async route => {
    // If an interview readback reloads every stage, hold the unrelated request
    // until after confirmation so the old editor-unmount race is reproducible.
    if (reconciling) await unrelatedStageGate;
    await route.continue();
  });
  const question = "你上一次选新品时，哪一条信息影响了决定？";
  try {
    const reconcileRequest = page.waitForRequest(reconcileUrl);
    await page.goto(urls[0]! + "&tool=outcome");
    const actions = page.getByTestId("aidt-interview-chat-actions");
    await actions.getByRole("button", { name: "编辑这道问题" }).click();
    const editor = actions.getByLabel("修改问题");
    await editor.fill(question);
    await reconcileRequest;
    const stageReadback = page.waitForResponse(response => response.request().method() === "GET"
      && /\/aidt\/stages\/2$/.test(response.url()));
    releaseReconcile();
    expect((await stageReadback).ok()).toBe(true);
    await expect(editor).toHaveValue(question);
    await actions.getByRole("button", { name: "确认这份问题清单" }).click();
    await expect(page.getByTestId("aidt-interview-save-state")).toHaveText("已保存");
  } finally {
    releaseReconcile();
    releaseUnrelatedStage();
    await page.unroute(reconcileUrl);
    await page.unroute(unrelatedStageUrl);
  }
  await expect(page.getByTestId("aidt-interview-question-list")).toContainText(question);
  await page.reload();
  await expect(page.getByText(question, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("interview-chat-confirmed.png") });
  const artifactList = page.getByTestId("chat-artifacts-panel");
  const backToArtifacts = () => page.getByRole("button", { name: /产物列表/ }).click();
  await backToArtifacts();
  await expect(artifactList.getByTestId("chat-host-artifact")).toContainText("U01");
  await expect(artifactList.getByTestId("chat-artifacts-empty")).toHaveCount(0);
  await artifactList.getByTestId("chat-host-artifact").click();
  await expect(page.getByTestId("aidt-interview-question-list")).toContainText(question);
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(first);

  const second = await openInterview(page, urls[1]! + "&tool=outcome");
  expect(second).not.toBe(first);
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
  await backToArtifacts();
  await expect(artifactList.getByTestId("chat-host-artifact")).toContainText("U02");
  await expect(artifactList).not.toContainText("U01");
  await artifactList.getByTestId("chat-host-artifact").click();
  await expect(page.getByTestId("aidt-interview-question-list")).toContainText("U02 的测试清单");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(second);
});

test.describe("recording evidence in the interview Chat", () => {
  test.use({ permissions: ["microphone"] });

  test("authorized photo and checked recording make an illustrated, versioned finding card", async ({ page }) => {
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
    const problemId = randomUUID();
    const topic = "顾客在菜单前如何选择饮料？";
    const headers = { Authorization: "Bearer " + await bearerOf(page) };
    const projectStages = "/__fullstack_api/projects/" + projectId + "/aidt/stages";
    const problem = await page.request.put(projectStages + "/1", { headers, data: {
      operationId: randomUUID(), expectedRevision: 0, sourceStageRevisions: [],
      content: { schemaVersion: 1, draft: { fields: {
        problemHandoffEntity: problemId,
        ["problemEntity:" + problemId]: JSON.stringify({ id: problemId, title: "菜单饮料选择", archived: false }),
        ["problemDraft:" + problemId]: JSON.stringify({ initial: topic, scene: "顾客在菜单前比较饮料", rewrittenTheme: topic }),
      }, ideas: [], selectedIdeaId: "" } },
    } });
    expect(problem.ok()).toBe(true);
    const fields = Object.fromEntries([first, sibling].map((id, index) => ["interviewRecord:" + id,
      JSON.stringify({ version: 1, id, code: "U0" + (index + 1), topicRevision: 1, topic, goal: "了解选择",
        original: "怎么选饮料？", adopted: "上次怎么选的？", guideConfirmed: true,
        consent: { notes: true, photos: false, audio: true, capture: true, asr: false, observedAt: new Date().toISOString() } })]));
    const endpoint = projectStages + "/2";
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
    const stage = async () => (await (await page.request.get(endpoint, { headers })).json()).stage;
    const head = async () => (await stage()).content.draft;
    await expect.poll(async () => Object.keys((await head()).fields).some(key => key.startsWith("captured:interviewMaterial:" + first + ":"))).toBe(true);
    await page.reload();
    await materials();
    const select = page.getByRole("combobox", { name: "转写原件", exact: true });
    await expect(select.getByRole("option")).toHaveCount(2);
    const recording = select.getByRole("option", { name: /^U01-.*\.wav$/ });
    await expect(recording).toHaveCount(1);
    await select.selectOption({ index: 1 });
    await expect(select.locator("option:checked")).toHaveText(/^U01-.*\.wav$/);
    await page.getByLabel("定位（如 01:42 或第 3 段）").fill("00:01");
    await page.getByLabel("校对后的摘录").fill("我先看口味");
    await page.getByLabel("已对照原始材料校对").check();
    await expect.poll(async () => JSON.parse((await head()).fields["interviewTranscript:" + first] || "{}").checked).toBe(true);
    const photoName = "U01-合成现场照片.png";
    const photoData = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement("canvas"), { width: 720, height: 420 });
      const fixture = canvas.getContext("2d")!;
      fixture.fillStyle = "#f3dbc9";
      fixture.fillRect(0, 0, canvas.width, canvas.height);
      fixture.fillStyle = "#763d4a";
      fixture.fillRect(200, 55, 320, 310);
      fixture.fillStyle = "white";
      fixture.font = "30px sans-serif";
      fixture.fillText("合成测试 · 饮料菜单", 218, 117);
      for (const y of [155, 210, 265]) fixture.fillRect(241, y, 237, 15);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    const scene = "午休时，她在食堂饮品窗口的菜单前逐项比较两种口味，随后选择熟悉的饮品。";
    const findingActions = page.getByTestId("aidt-interview-chat-actions");
    const editFinding = async () => {
      const editor = findingActions.getByTestId("aidt-interview-finding-editor");
      await expect(editor).toBeVisible();
      return editor;
    };
    const editor = await editFinding();
    await editor.getByRole("textbox", { name: "一句发现", exact: true }).fill("她先比较口味，最后仍选熟悉的饮品。");
    await editor.getByRole("textbox", { name: "具体情况", exact: true }).fill(scene);
    await expect.poll(async () => (await head()).discoveryCards?.find((card: { id: string }) => card.id === first)?.context).toBe(scene);
    await expect(editor.getByRole("button", { name: "上传照片", exact: true })).toHaveCount(0);
    await editor.getByRole("checkbox", { name: "已获受访者授权共享照片", exact: true }).check();
    await expect.poll(async () => JSON.parse((await head()).fields["interviewRecord:" + first]).consent.photos).toBe(true);
    const photoInput = editor.getByLabel("U01发现卡照片选择文件", { exact: true });
    await expect(editor.getByRole("button", { name: "上传照片", exact: true })).toBeVisible();
    await expect(photoInput).toHaveCSS("display", "none");
    const editorWidth = await editor.evaluate(element => ({ scroll: element.scrollWidth, visible: element.clientWidth }));
    expect(editorWidth.scroll).toBeLessThanOrEqual(editorWidth.visible);
    const photoFile = { name: photoName, mimeType: "image/png", buffer: Buffer.from(photoData, "base64") };
    const uploadPath = "/__fullstack_api/projects/" + projectId + "/artifacts/upload";
    let photoUploadRequests = 0;
    page.on("request", request => {
      if (request.method() === "POST" && new URL(request.url()).pathname === uploadPath) photoUploadRequests += 1;
    });

    // A cancelled file choice is neither an upload nor a saved photograph.
    const beforeCancel = await stage();
    await photoInput.setInputFiles(photoFile);
    await expect(editor.getByRole("button", { name: "保存照片", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor.getByText("已取消本次关联，原照片与文字仍保留。", { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: "保存照片", exact: true })).toHaveCount(0);
    const cancelled = await stage();
    expect(cancelled.revision).toBe(beforeCancel.revision);
    expect(photoUploadRequests).toBe(0);
    expect(cancelled.content.draft.fields["discoveryPhoto:" + first] || "").toBe("");
    await expect(editor.getByRole("textbox", { name: "具体情况", exact: true })).toHaveValue(scene);

    await photoInput.setInputFiles(photoFile);
    await editor.getByRole("button", { name: "保存照片", exact: true }).click();
    await expect.poll(async () => JSON.parse((await head()).fields["discoveryPhoto:" + first] || "{}").name).toBe(photoName);
    const savedPhoto = JSON.parse((await head()).fields["discoveryPhoto:" + first]);
    expect(photoUploadRequests).toBe(1);
    expect(savedPhoto).toMatchObject({ projectId, name: photoName, sha256: createHash("sha256").update(photoFile.buffer).digest("hex") });
    expect(savedPhoto.versionId).toBeTruthy();
    await page.reload();
    await editFinding();
    await expect(editor.getByRole("textbox", { name: "具体情况", exact: true })).toHaveValue(scene);
    await expect.poll(() => editor.getByRole("img", { name: "U01 的授权访谈照片" }).evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(720);
    expect(JSON.parse((await head()).fields["discoveryPhoto:" + first])).toEqual(savedPhoto);

    // Reject one replacement request before it reaches storage; keep the real prior photo and text.
    await page.route(url => url.pathname === uploadPath, route => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ reasonCode: "SYNTHETIC_PHOTO_UPLOAD_FAILURE" }),
    }), { times: 1 });
    await photoInput.setInputFiles({ ...photoFile, name: "U01-取消替换.png" });
    await editor.getByRole("button", { name: "保存照片", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("材料保存或回读未通过，尚未关联本次文件。");
    expect(photoUploadRequests).toBe(2);
    expect(JSON.parse((await head()).fields["discoveryPhoto:" + first])).toEqual(savedPhoto);
    await expect(editor.getByRole("textbox", { name: "具体情况", exact: true })).toHaveValue(scene);
    await expect(editor.getByRole("img", { name: "U01 的授权访谈照片" })).toBeVisible();
    await editor.getByRole("button", { name: "取消", exact: true }).click();

    await sendViaWorkbench(page, `合成访谈验收：${scene}请整理本次发现。`);
    await expect.poll(async () => (await head()).discoveryCards?.[0]?.sourceRef, { timeout: 60_000 }).toContain("00:01");
    await page.goto(url);
    const output = page.getByTestId("aidt-interview-finding");
    await output.getByText("发现详情与来源").click();
    await expect(output.getByText(scene, { exact: true })).toBeVisible();
    await expect(output).toContainText("我先看口味");
    await expect(output).toContainText("00:01");
    await expect(output.getByRole("textbox")).toHaveCount(0);
    await expect(output.getByText("受访者原话", { exact: true })).toBeVisible();
    const photo = output.getByRole("img", { name: "U01 的授权访谈照片" });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(720);
    const download = page.waitForEvent("download");
    await output.getByRole("link", { name: "下载真实原件" }).click();
    const original = await download;
    expect(original.suggestedFilename()).toBe(photoName);
    expect(await readFile(await original.path())).toEqual(Buffer.from(photoData, "base64"));
    await editFinding();
    await editor.getByText("原话与来源", { exact: true }).click();
    await expect(editor.getByLabel("可定位的受访者原话", { exact: true })).toHaveValue("我先看口味");
    await editor.getByRole("button", { name: "确认人物发现卡", exact: true }).click();
    await expect.poll(async () => (await head()).fields["interviewConfirmed:" + first]).toBe("true");
    await expect(output.getByRole("button", { name: "导出人物发现卡 PDF", exact: true })).toBeEnabled();
    await output.locator("article").screenshot({ path: test.info().outputPath("illustrated-discovery-card.png") });
    await page.screenshot({ path: test.info().outputPath("sourced-recording-finding.png") });

    const savedStage = await stage();
    const photoArtifact = JSON.parse(savedStage.content.draft.fields["discoveryPhoto:" + first]).artifactId;
    const history = url + "&entityRevision=" + savedStage.revision + "&sourceId=" + encodeURIComponent(photoArtifact);
    const historyTab = await page.context().newPage();
    await historyTab.bringToFront();
    await historyTab.goto(history);
    const historyFinding = historyTab.getByTestId("aidt-interview-finding");
    const historyPhoto = historyFinding.getByRole("img", { name: "U01 的授权访谈照片" });
    await expect(historyPhoto).toBeVisible();
    await page.bringToFront();

    await openInterview(page, path + "?step=2&entity=" + sibling + "&tool=outcome");
    await expect(page.getByTestId("aidt-interview-finding")).not.toContainText("我先看口味");
    await expect(page.getByTestId("aidt-interview-finding").getByText("暂无授权照片。")).toBeVisible();
    await expect(photo).toHaveCount(0);

    await openInterview(page, url);
    await editFinding();
    await editor.getByRole("checkbox", { name: "已获受访者授权共享照片", exact: true }).uncheck();
    await expect.poll(async () => (await head()).fields["discoveryPhoto:" + first] || "").toBe("");
    const recheckedConsent = historyTab.waitForResponse(response => response.request().method() === "GET"
      && /\/aidt\/stages\/2$/.test(response.url()));
    await historyTab.bringToFront();
    await historyTab.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect((await recheckedConsent).ok()).toBe(true);
    await expect(historyFinding.getByText("暂无授权照片。")).toBeVisible();
    await expect(historyPhoto).toHaveCount(0);
    await historyTab.reload();
    await expect(historyTab.getByTestId("aidt-entity-history").getByRole("alert")).toHaveText("此访谈版本无法查看该原件。");
    await expect(historyPhoto).toHaveCount(0);
    await historyTab.close();
    await page.goto(url);
    await expect(output.getByText("暂无授权照片。")).toBeVisible();
    await expect(photo).toHaveCount(0);
  });
});

test("six brainstorm methods keep their explicit method, frozen HMW and independent Chat without completing the stage", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill("六种发散方法 " + randomUUID().slice(0, 8));
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const path = new URL(page.url()).pathname, projectId = path.split("/").pop()!;
  const headers = { Authorization: "Bearer " + await bearerOf(page) };
  const stagePath = "/__fullstack_api/projects/" + projectId + "/aidt/stages/";
  const selectedHmw = { id: "method-hmw", text: "如何帮助午休赶课的学生预估等候时间？" };
  const otherHmw = { id: "method-hmw-other", text: "如何帮助学生看懂领取饮品的顺序？" };
  // Only seed the normal upstream HMW fixture; no Stage 4 output or completion is manufactured.
  const seeded = await page.request.put(stagePath + "3", { headers, data: {
    operationId: randomUUID(), expectedRevision: 0, sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: { fields: {
      ["definitionHmw:" + selectedHmw.id]: JSON.stringify({ ...selectedHmw, rationale: "合成方法交互验收来源", cardIds: [], personaIds: [], confirmed: true, archived: false }),
      ["definitionHmw:" + otherHmw.id]: JSON.stringify({ ...otherHmw, rationale: "第二道合成研究问题", cardIds: [], personaIds: [], confirmed: true, archived: false }),
      "definitionHmw:unconfirmed-hmw": JSON.stringify({ id: "unconfirmed-hmw", text: "尚未确认的问题", rationale: "合成草稿", cardIds: [], personaIds: [], confirmed: false, archived: false }),
      definitionHmwId: selectedHmw.id, hmw: selectedHmw.text,
    }, ideas: [], selectedIdeaId: "" } },
  } });
  expect(seeded.ok()).toBe(true);
  const definition = (await (await page.request.get(stagePath + "3", { headers })).json()).stage;
  const methods = [
    { id: "free", label: "自由联想", prompt: /联想/ },
    { id: "reverse", label: "逆向思考", prompt: /更糟/ },
    { id: "scamper", label: "SCAMPER", prompt: /替代/ },
    { id: "analogy", label: "类比迁移", prompt: /其他领域|不同场景/ },
    { id: "role", label: "换位思考", prompt: /待验证|猜测/ },
    { id: "brainwriting", label: "静默脑写", prompt: /独立|安静/ },
  ] as const;
  const entityIds = new Set<string>(), threadIds = new Set<string>();
  const bindings: { entityId: string; threadId: string; source: typeof selectedHmw & { revision: number } }[] = [];
  let nativeModelRequests = 0;
  page.on("request", request => {
    if (request.method() === "POST" && /\/copilotkit\/agent\/[^/]+\/run$/.test(new URL(request.url()).pathname)) nativeModelRequests += 1;
  });
  const stage4 = async () => (await (await page.request.get(stagePath + "4", { headers })).json()).stage;
  for (const [index, method] of methods.entries()) {
    const chosenHmw = index % 2 === 0 ? selectedHmw : otherHmw;
    const source = { ...chosenHmw, revision: definition.revision };
    await page.goto(path + "?step=4");
    await page.getByRole("region", { name: "头脑风暴", exact: true }).getByTestId("aidt-new-entity-card").click();
    const dialog = page.getByRole("dialog", { name: "新建头脑风暴", exact: true });
    const selector = dialog.getByRole("combobox", { name: "发散方法", exact: true });
    const hmwSelector = dialog.getByRole("combobox", { name: "HMW", exact: true });
    await expect(hmwSelector).toHaveValue("");
    expect(await hmwSelector.getByRole("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual([selectedHmw.id, otherHmw.id]);
    await expect(selector).toHaveValue("");
    expect(await selector.getByRole("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual(methods.map(item => item.id));
    const title = "方法验收 · " + method.label;
    await dialog.getByRole("textbox", { name: "场次名称", exact: true }).fill(title);
    await hmwSelector.selectOption(chosenHmw.id);
    await selector.selectOption(method.id);
    await expect(selector.locator("option:checked")).toHaveText(method.label);
    await expect(dialog.getByTestId("aidt-brainstorm-method-guide")).toContainText(method.prompt);
    const count = dialog.getByRole("spinbutton", { name: "希望探索的点子数", exact: true });
    await expect(count).toBeEditable();
    await expect(count).toHaveValue("5");
    await dialog.screenshot({ path: test.info().outputPath("brainstorm-method-" + method.id + ".png") });
    await dialog.getByRole("button", { name: "开始头脑风暴", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("entity")).toMatch(/^brainstorm-/);
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
    const entityId = new URL(page.url()).searchParams.get("entity")!;
    const threadId = new URL(page.url()).searchParams.get("thread")!;
    expect(entityIds.has(entityId)).toBe(false);
    expect(threadIds.has(threadId)).toBe(false);
    entityIds.add(entityId); threadIds.add(threadId);
    bindings.push({ entityId, threadId, source });
    expect(JSON.parse((await stage4()).content.draft.fields["ideaBrainstorm:" + entityId])).toMatchObject({ id: entityId, title, source, method: method.id, count: 5, candidates: [] });
    await page.goto(path + "?step=4");
    const card = page.getByRole("link", { name: "打开「" + title + "」对话", exact: true });
    await expect(card).toContainText(method.label);
    await card.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(threadId);
    await page.reload();
    await expect(composer(page)).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(threadId);
    expect(new URL(page.url()).searchParams.get("entity")).toBe(entityId);
    expect(JSON.parse((await stage4()).content.draft.fields["ideaBrainstorm:" + entityId])).toMatchObject({ source, method: method.id, count: 5, candidates: [] });
    // No student message was sent, so open the same owned entity's inspector explicitly.
    const outcome = new URL(page.url());
    outcome.searchParams.set("tool", "outcome");
    expect(await openInterview(page, outcome.pathname + outcome.search)).toBe(threadId);
    expect(new URL(page.url()).searchParams.get("entity")).toBe(entityId);
    const output = page.getByTestId("aidt-brainstorm-output");
    await expect(output).toBeVisible();
    await expect(output).toContainText(method.label);
    await expect(output.getByRole("link", { name: "第 3 步 V" + source.revision, exact: true })).toHaveAttribute("href", path + "?step=3&entity=" + chosenHmw.id + "&entityRevision=" + source.revision);
    await expect(page.getByRole("region", { name: "筛选点子", exact: true }).getByRole("link", { name: "进入原型制作", exact: true })).toHaveCount(0);
    await page.goto(path);
    await expect(page.getByTestId("aidt-stage-save-4")).toContainText("已保存草稿");
    await expect(page.getByTestId("aidt-stage-save-4")).toHaveAttribute("data-completed", "false");
  }
  expect(entityIds.size).toBe(6);
  expect(threadIds.size).toBe(6);
  // Editing an upstream test fixture cannot retarget an existing round or Chat.
  const changedDefinition = JSON.parse(JSON.stringify(definition));
  changedDefinition.content.draft.fields["definitionHmw:" + selectedHmw.id] = JSON.stringify({ ...JSON.parse(changedDefinition.content.draft.fields["definitionHmw:" + selectedHmw.id]), text: "重新研究后的待确认问题", confirmed: false });
  expect((await page.request.put(stagePath + "3", { headers, data: { operationId: randomUUID(), expectedRevision: definition.revision,
    sourceStageRevisions: definition.sourceStageRevisions, content: changedDefinition.content } })).ok()).toBe(true);
  for (const binding of bindings.slice(0, 2)) {
    await openInterview(page, path + "?" + new URLSearchParams({ step: "4", entity: binding.entityId, thread: binding.threadId, tool: "outcome" }));
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(binding.threadId);
    const output = page.getByTestId("aidt-brainstorm-output");
    await expect(output).toContainText(binding.source.text);
    expect(JSON.parse((await stage4()).content.draft.fields["ideaBrainstorm:" + binding.entityId]).source).toEqual(binding.source);
  }
  await page.goto(path + "?step=4");
  await page.getByRole("region", { name: "头脑风暴", exact: true }).getByTestId("aidt-new-entity-card").click();
  const newRoundHmw = page.getByRole("dialog", { name: "新建头脑风暴", exact: true }).getByRole("combobox", { name: "HMW", exact: true });
  await expect(newRoundHmw).toHaveValue("");
  expect(await newRoundHmw.getByRole("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean))).toEqual([otherHmw.id]);
  expect(nativeModelRequests).toBe(0);
});

test("directory creation saves named problems, findings, ideas and native Design prototypes before opening their chat", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByTestId("rail-aidt").click();
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill("建卡持久化 " + randomUUID().slice(0, 8));
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const pathname = new URL(page.url()).pathname;
  const threads = new Set<string>();
  const projectId = pathname.split("/").at(-1)!;
  const headers = { Authorization: "Bearer " + await bearerOf(page) };
  type SourceDraft = { fields: Record<string, string>; ideas: { id: string; title: string; description: string }[]; selectedIdeaId: string };
  let prototypeSource: { revision: number; brainstormId: string; ideaIds: string[]; chosenTitle: string } | undefined;
  async function seedSourceStage(stageId: number, transform: (previous: SourceDraft) => void, sourceStageRevisions?: { stageId: number; revision: number }[]) {
    const path = "/__fullstack_api/projects/" + projectId + "/aidt/stages/" + stageId;
    const { stage } = await (await page.request.get(path, { headers })).json();
    const draft = stage.content.draft;
    transform(draft);
    const response = await page.request.put(path, { headers, data: { operationId: randomUUID(), expectedRevision: stage.revision, sourceStageRevisions: sourceStageRevisions ?? stage.sourceStageRevisions, content: { ...stage.content, draft } } });
    expect(response.ok()).toBe(true);
    return (await response.json()).stage;
  }
  function syntheticReviewedSources(draft: SourceDraft, source: { id: string; text: string; revision: number }) {
    // Isolated directory fixture, not a browser upload, artifact read receipt,
    // model result or evidence that students completed these teaching activities.
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
    const items = [
      { title: "合成来源 · 等候比较卡", description: "用纸卡展示两处队列的预计等候。学生比较后选择队列。" },
      { title: "合成来源 · 领取路线图", description: "用箭头展示领取食品的顺序。学生按图寻找领取位置。" },
      { title: "合成来源 · 课间预约单", description: "用纸质清单记录可领取的时段。学生选择合适时段并登记。" },
    ];
    const brainstormId = "brainstorm-directory-" + randomUUID();
    let reviewed: SourceDraft = createAidtBrainstorm(draft, { id: brainstormId, title: "合成目录正式来源轮", source, method: "free", count: 3, candidates: [] });
    reviewed = addAidtBrainstormCandidates(reviewed, brainstormId, [{ messageId: "fixture-" + randomUUID(), items }]);
    const sheetIds = readAidtBrainstorm(reviewed.fields, brainstormId)!.candidates;
    const fixtures = sheetIds.map(id => reviewed.ideas.find(idea => idea.id === id)!);
    for (const idea of fixtures) {
      reviewed.fields["ideaFile:" + idea.id] = JSON.stringify({ projectId, runId: "fixture-only-not-uploaded", artifactId: "fixture-image-" + idea.id,
        versionId: "fixture-v1", name: "合成目录引用-未上传.png", mime: "image/png", sha256: createHash("sha256").update(image).digest("hex"), bytes: image.length });
      reviewed = confirmAidtIdeaFromChat(reviewed, idea.id, idea.description);
    }
    const selectedIds = sheetIds.slice(0, 2);
    reviewed = confirmAidtBrainstormSelection(reviewed, brainstormId, selectedIds);
    let classification = aidtBrainstormRoundClassificationDraft(reviewed, brainstormId, sheetIds);
    classification = setAidtIdeaCategory(classification, fixtures[0]!.id, "easy", true);
    classification = setAidtIdeaClassificationReason(classification, fixtures[0]!.id, "合成分类理由：纸卡材料容易准备。");
    classification = confirmAidtIdeaClassification(classification);
    const fields = Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, classification.fields[key]!]));
    reviewed = confirmAidtBrainstormClassification(reviewed, brainstormId, sheetIds, fields);
    const completed = confirmAidtBrainstormCompletion(reviewed, brainstormId, sheetIds, projectId);
    expect(completed).not.toBe(reviewed);
    expect(readAidtConfirmedBrainstormRounds(completed, projectId, { sessionId: brainstormId })[0]).toMatchObject({ sheetIds, selectedIds, legacy: false });
    expect(readAidtIdeaHandoff(completed, projectId)).toMatchObject({ hmw: source, sheetIds, selectedIds });
    return { draft: completed, brainstormId, sheetIds, selectedIds, chosenTitle: fixtures[0]!.title };
  }

  for (const [step, kind] of [[1, "问题"], [1, "问题"], [3, "意外发现"], [4, "点子"], [4, "头脑风暴"], [5, "原型"]] as const) {
    const title = kind + randomUUID().slice(0, 6);
    const directory = pathname + "?step=" + step;
    if (step === 4) await seedSourceStage(3, draft => {
      const persona = { id: "student", name: "午休赶课的学生", situation: "课间休息", behavior: "先看排队长度", need: "预估排队时间", limits: "合成来源", cardIds: [], confirmed: true, archived: false };
      draft.fields["definitionPersona:" + persona.id] = JSON.stringify(persona);
      for (const [id, text] of [["hmw-primary", "如何帮助学生挑选饮料？"], ["hmw-second", "如何预估等候时间？"]] as const) {
        draft.fields["definitionHmw:" + id] = JSON.stringify({ id, text, rationale: "合成建卡来源", cardIds: [], personaIds: [persona.id], confirmed: true, archived: false });
      }
      draft.fields.definitionHmwId = "hmw-primary";
      draft.fields.hmw = "如何帮助学生挑选饮料？";
    });
    if (step === 5) {
      await seedSourceStage(4, draft => {
        for (const idea of draft.ideas) idea.description = "制作比较卡";
        draft.fields.ideaHandoffIds = JSON.stringify(draft.ideas.map(idea => idea.id));
      });
      // The old single-sentence selection is still an editable draft, not S5 input.
      await page.goto(directory);
      await page.getByTestId("aidt-new-entity-card").click();
      const incomplete = page.getByRole("dialog");
      await incomplete.getByRole("textbox", { name: "原型名称", exact: true }).fill(title);
      await expect(incomplete.getByRole("group", { name: "来源点子", exact: true }).getByRole("checkbox")).toHaveCount(0);
      await expect(incomplete.getByRole("button", { name: "创建原型", exact: true })).toBeDisabled();
      await incomplete.getByRole("button", { name: "取消", exact: true }).click();
      const definitionResponse = await page.request.get("/__fullstack_api/projects/" + projectId + "/aidt/stages/3", { headers });
      expect(definitionResponse.ok()).toBe(true);
      const { stage: definition } = await definitionResponse.json();
      const source = { id: "hmw-second", text: "如何预估等候时间？", revision: definition.revision };
      expect(JSON.parse(definition.content.draft.fields["definitionHmw:" + source.id])).toMatchObject({ id: source.id, text: source.text, confirmed: true, archived: false });
      let selectedIds: string[] = [];
      let brainstormId = "";
      let chosenTitle = "";
      const saved = await seedSourceStage(4, draft => {
        const fixture = syntheticReviewedSources(draft, source);
        Object.assign(draft, fixture.draft);
        selectedIds = fixture.selectedIds;
        brainstormId = fixture.brainstormId;
        chosenTitle = fixture.chosenTitle;
      }, [{ stageId: 3, revision: source.revision }]);
      expect(JSON.parse(saved.content.draft.fields.ideaHmwSource)).toEqual(source);
      expect(readAidtIdeaHandoff(saved.content.draft, projectId)?.selectedIds).toEqual(selectedIds);
      prototypeSource = { revision: saved.revision, brainstormId, ideaIds: [selectedIds[0]!], chosenTitle };
      test.info().annotations.push({ type: "fixture-scope", description: "S5 directory uses three synthetic reviewed sheets and fixture-only image reference markers; no upload, artifact-read, AI or teaching acceptance is claimed." });
    }
    await page.goto(directory);
    if (kind === "点子") await page.getByRole("button", { name: "新建点子", exact: true }).click();
    else if (kind === "头脑风暴") await page.getByRole("region", { name: "头脑风暴", exact: true }).getByTestId("aidt-new-entity-card").click();
    else await page.getByTestId("aidt-new-entity-card").click();
    if (step === 3) await page.getByRole("button", { name: "新建" + kind, exact: true }).click();
    {
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: /名称/ }).fill(title);
      await dialog.getByTestId("card-create-tag-input").fill("课堂 QA");
      if (kind === "点子") await dialog.getByLabel("来源 HMW").selectOption("hmw-second");
      if (kind === "头脑风暴") {
        await dialog.getByRole("combobox", { name: "HMW", exact: true }).selectOption("hmw-second");
        await dialog.getByRole("combobox", { name: "发散方法" }).selectOption("reverse");
        await dialog.getByRole("spinbutton", { name: "希望探索的点子数" }).fill("7");
      }
      if (kind === "原型") {
        const sources = dialog.getByRole("group", { name: "来源点子", exact: true });
        const rounds = dialog.getByRole("combobox", { name: "已确认 Ideation 列表", exact: true });
        await expect(rounds).toHaveValue("");
        await expect(sources.getByRole("checkbox")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "创建原型", exact: true })).toBeDisabled();
        await rounds.selectOption(prototypeSource!.brainstormId);
        await expect(sources.getByRole("checkbox")).toHaveCount(3);
        for (const checkbox of await sources.getByRole("checkbox").all()) await expect(checkbox).not.toBeChecked();
        await expect(dialog.getByRole("button", { name: "创建原型", exact: true })).toBeDisabled();
        await sources.getByRole("checkbox", { name: prototypeSource!.chosenTitle, exact: true }).check();
        await expect(dialog.getByRole("button", { name: "创建原型", exact: true })).toBeEnabled();
      }
      const screenshot = kind === "头脑风暴" ? "stage-4-brainstorm-dialog.png" : "stage-" + step + "-creation-dialog.png";
      await page.screenshot({ path: test.info().outputPath(screenshot) });
      const submit = dialog.locator('button[type="submit"]');
      if (!threads.size) {
        const pattern = "**/projects/*/aidt/stages/1";
        let lost: { operationId: string } | undefined;
        await page.route(pattern, async route => {
          if (route.request().method() !== "PUT" || lost) return route.continue();
          lost = route.request().postDataJSON();
          const committed = await route.fetch();
          expect(committed.ok()).toBe(true);
          await route.abort("failed");
        });
        await submit.click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        const retry = page.waitForRequest(request => request.method() === "PUT" && request.url().endsWith("/aidt/stages/1"));
        await submit.click();
        expect((await retry).postDataJSON().operationId).toBe(lost?.operationId);
        await page.unroute(pattern);
      } else await submit.click();
    }
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
    const created = new URL(page.url());
    const id = created.searchParams.get("entity")!;
    const thread = created.searchParams.get("thread")!;
    expect(id).toBeTruthy();
    if (step === 4) {
      const { stage } = await (await page.request.get("/__fullstack_api/projects/" + projectId + "/aidt/stages/4", { headers })).json();
      const definition = await (await page.request.get("/__fullstack_api/projects/" + projectId + "/aidt/stages/3", { headers })).json();
      const hmw = { id: "hmw-second", text: "如何预估等候时间？", revision: definition.stage.revision };
      if (kind === "头脑风暴") {
        expect(JSON.parse(stage.content.draft.fields["ideaBrainstorm:" + id])).toMatchObject({ id, title, source: hmw, method: "reverse", count: 7 });
      } else expect(JSON.parse(stage.content.draft.fields["ideaHmwSource:" + id])).toEqual(hmw);
    }
    if (step === 5) {
      const response = await page.request.get("/__fullstack_api/projects/" + projectId + "/aidt/stages/5", { headers });
      expect(response.ok()).toBe(true);
      const { stage } = await response.json();
      const entity = JSON.parse(stage.content.draft.fields["prototypeEntity:" + id]);
      expect(JSON.parse(entity.prototypeIdeaSource)).toEqual({ revision: prototypeSource!.revision, brainstormId: prototypeSource!.brainstormId, ideaIds: prototypeSource!.ideaIds });
    }
    expect(threads.has(thread)).toBe(false);
    threads.add(thread);
    await page.goto(directory);
    const card = page.locator('a[href*="entity=' + id + '"]').first();
    await expect(card).toBeVisible();
    await expect(card.locator("xpath=ancestor::li[1]").getByRole("list", { name: "卡片标签" })).toContainText("课堂 QA");
    await card.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(thread);
    await page.reload();
    await expect(composer(page)).toBeVisible();
    expect(new URL(page.url()).searchParams.get("entity")).toBe(id);
  }
});
