import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { project } from "@repo/contracts";
import * as stages from "@repo/contracts/aidt-stages";
import * as memberChat from "@repo/contracts/project-member-chat";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";

const enabled = (value: string | undefined) => value === "1" || value === "true";
interface AuditClient { query(sql: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
// Match existing native E2E database audits without importing the API runtime
// into Next's frontend type-check dependency graph.
const { PgDatabase } = createRequire(resolve(process.cwd(), "../api/package.json"))("./src/infrastructure/db/pg-database.ts");
async function audit<T>(work: (client: AuditClient) => Promise<T>): Promise<T> {
  if (!process.env.WORKSPACEX_ISOLATION_ID || !process.env.WORKSPACEX_DB?.startsWith("wsx_")) throw new Error("owned isolated database required");
  const config = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import {appConfig} from '../api/src/infrastructure/db/pg-config.ts'; process.stdout.write(JSON.stringify(appConfig()));"], { cwd: process.cwd(), encoding: "utf8" }));
  const db = new PgDatabase(config);
  try { return await db.withTenant(FULLSTACK_E2E.collaborationOrgId, work); } finally { await db.close(); }
}
async function login(page: Page, role: "lead" | "member" | "admin" = "lead") {
  const identities = {
    lead: { email: FULLSTACK_E2E.collaborationLeadEmail, password: FULLSTACK_E2E.collaborationLeadPassword },
    member: { email: FULLSTACK_E2E.collaborationMemberEmail, password: FULLSTACK_E2E.collaborationMemberPassword },
    admin: { email: FULLSTACK_E2E.collaborationAdminEmail, password: FULLSTACK_E2E.collaborationAdminPassword },
  };
  await page.goto("/login");
  await page.getByTestId("login-email").fill(identities[role].email);
  await page.getByTestId("login-password").fill(identities[role].password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}
async function request(page: Page, path: string, method = "GET", body?: unknown) {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  const response = await page.request.fetch(`/__fullstack_api${path}`, { method, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { data: body }) });
  return { status: response.status(), data: await response.json() };
}
async function createProject(page: Page, name: string, aidt = true) {
  const created = await request(page, project.operations.createProject.path, "POST", { orgId: FULLSTACK_E2E.collaborationOrgId, name: `${name} ${randomUUID().slice(0, 8)}`, kind: "general", blueprintVersionId: null });
  expect(created.status, JSON.stringify(created.data)).toBeLessThan(300);
  // Existing, explicitly registered KNOWN_CONTRACT_GAPS.P3: project creation
  // intentionally returns no fabricated provenanceEventId (controller header).
  // This fixture helper validates the actually implemented container shape;
  // A/B responses below retain their complete, unmodified contract parsers.
  const id = project.operations.createProject.out.omit({ provenanceEventId: true }).parse(created.data).id;
  if (aidt) {
    const tagged = await request(page, `/projects/${id}/tags`, "PATCH", { projectId: id, tags: ["workspacex:aidt"] });
    expect(tagged.status, JSON.stringify(tagged.data)).toBeLessThan(300);
  }
  return id;
}
async function addMember(page: Page, projectId: string) {
  const added = await request(page, `/projects/${projectId}/collaborators`, "POST", { projectId, userId: FULLSTACK_E2E.collaborationMemberUserId, role: "collaborator" });
  expect(added.status, JSON.stringify(added.data)).toBeLessThan(300);
}
async function modelActivity(projectId: string) {
  return audit(async client => (await client.query("SELECT (SELECT count(*) FROM agent_runs r JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id WHERE r.org_id=$1 AND t.project_id=$2)::int AS runs,(SELECT count(*) FROM model_request_starts WHERE org_id=$1 AND project_id=$2)::int AS requests", [FULLSTACK_E2E.collaborationOrgId, projectId])).rows[0]);
}
function draft(text: string): stages.SaveStageInput["content"] {
  return { schemaVersion: 1, draft: { fields: { initial: text }, ideas: [], selectedIdeaId: "" } };
}
async function exposedGeometry(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeInViewport({ ratio: 0.8 });
  const geometry = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      hits: [0.25, 0.5, 0.75].map(fraction => {
        const x = rect.x + rect.width / 2, y = rect.y + rect.height * fraction;
        const hit = document.elementFromPoint(x, y);
        return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && Boolean(hit && (hit === element || element.contains(hit)));
      }) };
  });
  expect(geometry.hits).toEqual([true, true, true]);
  return geometry;
}

test("shared AIDT stages: two members persist revisions, stale CAS and isolation remain explicit", async ({ page, browser }) => {
  test.skip(!isAidtModuleEnabled() || !enabled(process.env.ENABLE_AIDT_MODULE), "Optional AIDT frontend and backend must both be explicitly enabled.");
  test.setTimeout(120_000);
  await login(page);
  const projectId = await createProject(page, "共享阶段真实回归");
  await addMember(page, projectId);
  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
  try {
    const member = await memberContext.newPage();
    await login(member, "member");
    const path = `/projects/${projectId}/aidt/stages/1`;
    const operationId = randomUUID();
    const initial = { projectId, stageId: 1, operationId, expectedRevision: 0, content: draft("学生测试输入：先观察午间取餐。尚未验证。"), sourceStageRevisions: [] };
    const before = await modelActivity(projectId);
    const first = await request(page, path, "PUT", initial);
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    const firstSaved = stages.operations.save.out.parse(first.data);
    expect(firstSaved).toMatchObject({ replayed: false, stage: { revision: 1, updatedBy: FULLSTACK_E2E.collaborationLeadUserId, content: initial.content } });
    const memberRead = await request(member, path);
    expect(memberRead.status).toBe(200);
    expect(stages.operations.get.out.parse(memberRead.data).stage).toEqual(firstSaved.stage);
    const replay = await request(page, path, "PUT", initial);
    expect(replay.status).toBe(200);
    expect(stages.operations.save.out.parse(replay.data)).toEqual({ stage: firstSaved.stage, replayed: true });
    const changedOperation = await request(page, path, "PUT", { ...initial, content: draft("同一操作标识不能换成另一份文字") });
    expect(changedOperation.status).toBe(409);
    expect(JSON.stringify(changedOperation.data)).toContain("AIDT_STAGE_OPERATION_CONFLICT");
    const stale = await request(member, path, "PUT", { ...initial, operationId: randomUUID(), content: draft("组员过期草稿不得覆盖") });
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.data)).toContain("AIDT_STAGE_REVISION_CONFLICT");
    expect(stages.operations.get.out.parse((await request(page, path)).data).stage).toEqual(firstSaved.stage);
    const second = await request(member, path, "PUT", { ...initial, operationId: randomUUID(), expectedRevision: 1, content: draft("组员修订：聚焦午休较短的学生。仍需访谈。") });
    expect(second.status, JSON.stringify(second.data)).toBe(200);
    const secondSaved = stages.operations.save.out.parse(second.data);
    expect(secondSaved.stage).toMatchObject({ revision: 2, updatedBy: FULLSTACK_E2E.collaborationMemberUserId });
    const stage2 = await request(page, `/projects/${projectId}/aidt/stages/2`, "PUT", { projectId, stageId: 2, operationId: randomUUID(), expectedRevision: 0, content: draft("学生拟定访谈初稿"), sourceStageRevisions: [{ stageId: 1, revision: 1 }] });
    expect(stage2.status, JSON.stringify(stage2.data)).toBe(200);
    expect(stages.operations.save.out.parse(stage2.data).stage.sourceStageRevisions).toEqual([{ stageId: 1, revision: 1 }]);
    const history = await request(member, `${path}/revisions?beforeRevision=2&limit=1`);
    expect(history.status).toBe(200);
    expect(stages.operations.history.out.parse(history.data).items).toEqual([firstSaved.stage]);
    const summaries = stages.operations.list.out.parse((await request(page, `/projects/${projectId}/aidt/stages`)).data);
    expect(summaries.items).toHaveLength(6);
    expect(summaries.items.find(item => item.stageId === 1)?.revision).toBe(2);
    expect(summaries.items.find(item => item.stageId === 6)?.revision).toBe(0);
    // Re-authenticate rather than relying on one page's in-memory state.
    await memberContext.clearCookies();
    await member.evaluate(() => localStorage.clear());
    await login(member, "member");
    expect(stages.operations.get.out.parse((await request(member, path)).data).stage).toEqual(secondSaved.stage);
    await page.goto(`/aidt/${projectId}?step=1&tool=outcome`);
    await member.goto(`/aidt/${projectId}?step=1&tool=outcome`);
    await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue("组员修订：聚焦午休较短的学生。仍需访谈。");
    await expect(member.getByLabel("初始问题", { exact: true })).toHaveValue("组员修订：聚焦午休较短的学生。仍需访谈。");
    const localText = "本页保留：先验证午休短的情境，不把推测写成结论。";
    await page.getByLabel("初始问题", { exact: true }).fill(localText);
    await member.getByLabel("初始问题", { exact: true }).fill("成员新修订：先访谈最近一次取餐经历。");
    await member.getByTestId("aidt-shared-save").click();
    await expect(member.getByTestId("aidt-shared-receipt")).toContainText("服务器已回执 V3");
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-conflict")).toBeVisible();
    await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue(localText);
    await expect(page.getByTestId("aidt-shared-use-server-base")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("aidt-shared-stage-conflict-preserves-input.png"), fullPage: true });
    await page.getByTestId("aidt-shared-use-server-base").click();
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-receipt")).toContainText("服务器已回执 V4");
    await member.reload();
    await expect(member.getByLabel("初始问题", { exact: true })).toHaveValue(localText);
    await page.screenshot({ path: test.info().outputPath("aidt-shared-stage-real-receipt.png"), fullPage: true });
    const stage6Path = `/projects/${projectId}/aidt/stages/6`;
    const stage6Input = { projectId, stageId: 6, operationId: randomUUID(), expectedRevision: 0, content: draft("学生测试反思：尚未开展真实测试。"), sourceStageRevisions: [] };
    expect((await request(page, stage6Path, "PUT", stage6Input)).status).toBe(200);
    const summaryReport = { markdown: "# 小组研究档案草稿\n尚未开展真实测试；不能宣称原型已获认可。", sourceStageRevisions: [{ stageId: 1, revision: 2 }, { stageId: 6, revision: 1 }] };
    const reportSaved = await request(page, stage6Path, "PUT", { ...stage6Input, operationId: randomUUID(), expectedRevision: 1, content: { ...stage6Input.content, summaryReport } });
    expect(reportSaved.status, JSON.stringify(reportSaved.data)).toBe(200);
    expect(stages.operations.save.out.parse(reportSaved.data).stage.content.summaryReport).toEqual(summaryReport);
    expect(stages.operations.get.out.parse((await request(member, stage6Path)).data).stage?.content.summaryReport).toEqual(summaryReport);
    const wrongReportStage = await request(page, `/projects/${projectId}/aidt/stages/2`, "PUT", { ...stage6Input, stageId: 2, operationId: randomUUID(), expectedRevision: 1, content: { ...stage6Input.content, summaryReport } });
    expect(wrongReportStage.status).toBe(422);
    const missingReportSource = await request(page, stage6Path, "PUT", { ...stage6Input, operationId: randomUUID(), expectedRevision: 2, content: { ...stage6Input.content, summaryReport: { ...summaryReport, sourceStageRevisions: [{ stageId: 3, revision: 123 }] } } });
    expect(missingReportSource.status).toBe(422);
    await page.goto(`/aidt/${projectId}?step=6&tool=outcome`);
    const stage6Reflection = "阶段六未保存反思：新版仍需真实测试。";
    await page.getByLabel("反思与解释", { exact: true }).fill(stage6Reflection);
    await page.getByTestId("aidt-open-report").click();
    await expect(page.getByLabel("小组报告草稿", { exact: true })).toHaveValue(summaryReport.markdown);
    const reviewedReport = `${summaryReport.markdown}\n小组审阅：下一步补测不同午休情境。`;
    await page.getByLabel("小组报告草稿", { exact: true }).fill(reviewedReport);
    await page.getByTestId("aidt-report-save").click();
    await expect(page.getByTestId("aidt-report-receipt")).toContainText("服务器版本 3");
    const reportOnly = stages.operations.get.out.parse((await request(page, stage6Path)).data).stage!;
    expect(reportOnly.content.draft).toEqual(stage6Input.content.draft);
    expect(reportOnly.content.summaryReport?.markdown).toBe(reviewedReport);
    expect(reportOnly.content.summaryReport?.sourceStageRevisions.some(source => source.stageId === 6)).toBe(false);
    await page.screenshot({ path: test.info().outputPath("aidt-report-real-shared-receipt.png"), fullPage: true });
    const reportGeometry = [];
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const editor = page.getByLabel("小组报告草稿", { exact: true });
      await editor.scrollIntoViewIfNeeded();
      reportGeometry.push({ width, editor: await exposedGeometry(editor) });
      await page.screenshot({ path: test.info().outputPath(`aidt-report-editor-${width}.png`), fullPage: true });
    }
    await member.goto(`/aidt/${projectId}?step=6&tool=report`);
    await expect(member.getByLabel("小组报告草稿", { exact: true })).toHaveValue(reviewedReport);
    await page.getByTestId("aidt-open-output").click();
    await expect(page.getByLabel("反思与解释", { exact: true })).toHaveValue(stage6Reflection);
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-receipt")).toContainText("服务器已回执 V4");
    const stageAndReport = stages.operations.get.out.parse((await request(page, stage6Path)).data).stage!;
    expect(stageAndReport.content.draft.fields.reflection).toBe(stage6Reflection);
    expect(stageAndReport.content.summaryReport?.markdown).toBe(reviewedReport);
    const otherProject = await createProject(page, "未授权另一小组");
    const privateOtherText = "另一小组的隔离测试材料，不应出现在拒绝响应。";
    expect((await request(page, `/projects/${otherProject}/aidt/stages/1`, "PUT", { ...initial, projectId: otherProject, operationId: randomUUID(), content: draft(privateOtherText) })).status).toBe(200);
    const deniedOtherStage = await request(member, `/projects/${otherProject}/aidt/stages/1`);
    expect(deniedOtherStage.status).toBe(404);
    expect(JSON.stringify(deniedOtherStage.data)).not.toContain(privateOtherText);
    expect((await request(member, `/projects/${otherProject}/aidt/stages/1`, "PUT", { ...initial, projectId: otherProject, operationId: randomUUID() })).status).toBe(404);
    const ordinaryProject = await createProject(page, "普通项目兼容", false);
    expect((await request(page, `/projects/${ordinaryProject}/aidt/stages/1`)).status).toBe(404);
    const persisted = await audit(client => client.query("SELECT stage_id,revision,updated_by,content,source_stage_revisions FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 ORDER BY stage_id,revision", [FULLSTACK_E2E.collaborationOrgId, projectId]));
    expect(persisted.rows).toHaveLength(9);
    expect(persisted.rows[1]).toMatchObject({ stage_id: 1, revision: 2, updated_by: FULLSTACK_E2E.collaborationMemberUserId, content: secondSaved.stage.content });
    expect(persisted.rows[3]).toMatchObject({ stage_id: 1, revision: 4, updated_by: FULLSTACK_E2E.collaborationLeadUserId, content: draft(localText) });
    expect(persisted.rows[4]).toMatchObject({ stage_id: 2, source_stage_revisions: [{ stageId: 1, revision: 1 }] });
    const after = await modelActivity(projectId);
    expect(after).toEqual(before);
    expect((await request(page, `/projects/${projectId}/archive`, "POST", { projectId })).status).toBeLessThan(300);
    expect((await request(member, path)).status).toBe(200);
    const archivedWrite = await request(member, path, "PUT", { ...initial, operationId: randomUUID(), expectedRevision: 4 });
    expect(archivedWrite.status).toBe(403);
    expect(JSON.stringify(archivedWrite.data)).toContain("AIDT_STAGE_READONLY");
    const evidence = test.info().outputPath("shared-stage-pg-readback.json");
    await writeFile(evidence, JSON.stringify({ projectId, persisted: persisted.rows, modelActivity: { before, after }, reportGeometry }, null, 2));
    await test.info().attach("shared-stage-pg-readback", { path: evidence, contentType: "application/json" });
  } finally { await memberContext.close(); }
});

test("pure human project chat: two authors, durable topic replies, idempotency and no AgentRun", async ({ page, browser }) => {
  test.skip(!enabled(process.env.ENABLE_PROJECT_MEMBER_CHAT) || !enabled(process.env.NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT), "Optional member text frontend and backend must both be explicitly enabled.");
  test.setTimeout(120_000);
  await login(page);
  // Team text is a project capability, including ordinary projects.
  const projectId = await createProject(page, "人类成员文字真实回归", false);
  await addMember(page, projectId);
  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
  try {
    const member = await memberContext.newPage();
    await login(member, "member");
    const path = `/projects/${projectId}/member-chat/messages`;
    const before = await modelActivity(projectId);
    const input = { projectId, clientMessageId: randomUUID(), text: "本地测试讨论：谁负责整理访谈问题？不是研究证据。", stageReference: { stageId: 2 } };
    const sent = await request(page, path, "POST", input);
    expect(sent.status, JSON.stringify(sent.data)).toBeLessThan(300);
    const root = memberChat.operations.postMessage.out.parse(sent.data);
    expect(root).toMatchObject({ replayed: false, message: { authorId: FULLSTACK_E2E.collaborationLeadUserId, text: input.text, threadRootId: null, stageReference: input.stageReference } });
    const replay = await request(page, path, "POST", input);
    expect(replay.status).toBeLessThan(300);
    expect(memberChat.operations.postMessage.out.parse(replay.data)).toEqual({ message: root.message, replayed: true });
    const conflict = await request(page, path, "POST", { ...input, text: "同一发送标识不能被改写" });
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(conflict.data)).toContain("IDEMPOTENCY_CONFLICT");
    const replySent = await request(member, path, "POST", { projectId, clientMessageId: randomUUID(), text: "我来整理初稿，明天一起校对。仅测试沟通。", threadRootId: root.message.id });
    expect(replySent.status, JSON.stringify(replySent.data)).toBeLessThan(300);
    const reply = memberChat.operations.postMessage.out.parse(replySent.data).message;
    expect(reply).toMatchObject({ authorId: FULLSTACK_E2E.collaborationMemberUserId, threadRootId: root.message.id });
    const replies = await request(page, `${path}/${root.message.id}/replies`);
    expect(replies.status).toBe(200);
    const topic = memberChat.operations.listReplies.out.parse(replies.data);
    expect(topic.root).toEqual(root.message);
    expect(topic.items).toContainEqual(reply);
    const nested = await request(page, path, "POST", { projectId, clientMessageId: randomUUID(), text: "不支持回复再建子话题", threadRootId: reply.id });
    expect(nested.status).toBe(422);
    expect(JSON.stringify(nested.data)).toContain("THREAD_ROOT_INVALID");
    const firstPage = memberChat.operations.listMessages.out.parse((await request(member, `${path}?afterSequence=0&limit=1`)).data);
    expect(firstPage.items).toEqual([root.message]);
    expect(firstPage.nextAfterSequence).toBe(root.message.sequence);
    const nextPage = memberChat.operations.listMessages.out.parse((await request(member, `${path}?afterSequence=${firstPage.nextAfterSequence}&limit=1`)).data);
    expect(nextPage.items).toEqual([reply]);
    expect(nextPage.threadUpdates).toContainEqual(expect.objectContaining({ rootMessageId: root.message.id, replyCount: 1 }));
    const roots = memberChat.operations.listMessages.out.parse((await request(page, path)).data);
    expect(roots.items).toEqual([root.message]);
    await page.goto(`/projects/${projectId}`);
    await page.getByTestId("global-member-chat-open").click();
    await expect(page.getByTestId("global-member-chat-project")).toHaveValue(projectId);
    const uiText = "界面测试：请组员校对访谈提纲，不是AI任务。";
    await page.getByTestId("project-member-input").fill(uiText);
    const uiSending = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes(path));
    await page.getByTestId("project-member-send").click();
    const uiSentResponse = await uiSending;
    expect(uiSentResponse.ok()).toBe(true);
    const uiRoot = memberChat.operations.postMessage.out.parse(await uiSentResponse.json()).message;
    await expect(page.getByTestId("project-member-message").filter({ hasText: uiText })).toBeVisible();
    await member.goto(`/projects/${projectId}`);
    await member.getByTestId("global-member-chat-open").click();
    await expect(member.getByTestId("project-member-message").filter({ hasText: uiText })).toBeVisible();
    await member.getByTestId(`project-member-topic-${uiRoot.id}`).click();
    const longReply = ["组员界面回复：我会先标出诱导式问题。", ...Array.from({ length: 14 }, (_, index) => `长回复滚动测试 ${index + 1}：讨论还需回到原话题的提问，不能丢失正在回复的上下文。`)].join("\n\n");
    await member.getByTestId("project-member-input").fill(longReply);
    const uiReplySending = member.waitForResponse(response => response.request().method() === "POST" && response.url().includes(path));
    await member.getByTestId("project-member-send").click();
    const uiReplyResponse = await uiReplySending;
    expect(uiReplyResponse.ok()).toBe(true);
    const uiReply = memberChat.operations.postMessage.out.parse(await uiReplyResponse.json()).message;
    expect(uiReply.threadRootId).toBe(uiRoot.id);
    await expect(member.getByTestId("project-member-replies")).toContainText(uiReply.text);
    const topicGeometry = [];
    for (const width of [1280, 375]) {
      await member.setViewportSize({ width, height: 900 });
      await member.getByTestId("project-member-replies").evaluate(element => { element.scrollTop = element.scrollHeight; });
      const rootSummary = member.getByTestId("project-member-topic-root");
      await expect(rootSummary).toHaveAttribute("data-message-id", uiRoot.id);
      await expect(rootSummary).toContainText(uiText);
      topicGeometry.push({ width, root: await exposedGeometry(rootSummary), input: await exposedGeometry(member.getByTestId("project-member-input")) });
      await member.screenshot({ path: test.info().outputPath(width === 1280 ? "project-human-member-topic-real.png" : "project-human-member-topic-375.png"), fullPage: true });
    }
    const unsentDraft = "跨页面保留的未发送讨论草稿";
    await page.getByTestId("project-member-input").fill(unsentDraft);
    await page.getByTestId("rail-research").click();
    await expect(page).toHaveURL(/\/research$/);
    await expect(page.getByTestId("project-member-input")).toHaveValue(unsentDraft);
    await expect(page.getByTestId("global-member-chat-project")).toHaveValue(projectId);
    await page.screenshot({ path: test.info().outputPath("project-human-chat-global-draft-retained.png"), fullPage: true });
    // The channel counter and message insert must commit together. Race ten
    // unique sends and a retry of one of them, then consume a late old-topic reply.
    const concurrentInputs = Array.from({ length: 10 }, (_, index) => ({ projectId, clientMessageId: randomUUID(), text: `并发测试消息 ${index + 1}，不是访谈证据。` }));
    const raced = await Promise.all([...concurrentInputs, concurrentInputs[0]!].map(payload => request(page, path, "POST", payload)));
    for (const result of raced) expect(result.status, JSON.stringify(result.data)).toBeLessThan(300);
    const concurrentResults = raced.map(result => memberChat.operations.postMessage.out.parse(result.data));
    const uniqueMessages = Array.from(new Map(concurrentResults.map(result => [result.message.id, result.message])).values());
    expect(uniqueMessages).toHaveLength(10);
    expect(concurrentResults.filter(result => result.replayed)).toHaveLength(1);
    const sequences = uniqueMessages.map(message => message.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 10 }, (_, index) => uiReply.sequence + index + 1));
    const lateReplyResult = await request(member, path, "POST", { projectId, clientMessageId: randomUUID(), text: "回到最早的话题补充：先把问题写具体。", threadRootId: root.message.id });
    expect(lateReplyResult.status).toBeLessThan(300);
    const lateReply = memberChat.operations.postMessage.out.parse(lateReplyResult.data).message;
    const lateDelta = memberChat.operations.listMessages.out.parse((await request(page, `${path}?afterSequence=${sequences[sequences.length - 1]}&limit=1`)).data);
    expect(lateDelta.items).toEqual([lateReply]);
    expect(lateDelta.threadUpdates).toContainEqual(expect.objectContaining({ rootMessageId: root.message.id, replyCount: 2, lastSequence: lateReply.sequence }));
    expect(lateDelta.nextAfterSequence).toBe(lateReply.sequence);
    const otherProject = await createProject(page, "隔离文字频道", false);
    const privateOtherText = "另一项目的私有讨论测试，不应泄露给非成员。";
    expect((await request(page, `/projects/${otherProject}/member-chat/messages`, "POST", { projectId: otherProject, clientMessageId: randomUUID(), text: privateOtherText })).status).toBeLessThan(300);
    const deniedOtherMessages = await request(member, `/projects/${otherProject}/member-chat/messages`);
    expect(deniedOtherMessages.status).toBe(404);
    expect(JSON.stringify(deniedOtherMessages.data)).not.toContain(privateOtherText);
    expect((await request(member, `/projects/${otherProject}/member-chat/messages`, "POST", { ...input, projectId: otherProject, clientMessageId: randomUUID() })).status).toBe(404);
    const wrongRoot = await request(page, `/projects/${otherProject}/member-chat/messages`, "POST", { ...input, projectId: otherProject, clientMessageId: randomUUID(), threadRootId: root.message.id });
    expect(wrongRoot.status).toBe(404);
    const adminContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
    try {
      const admin = await adminContext.newPage();
      await login(admin, "admin");
      expect((await request(admin, path)).status).toBe(404);
      expect((await request(admin, `${path}/${root.message.id}/replies`)).status).toBe(404);
      expect((await request(admin, path, "POST", { ...input, clientMessageId: randomUUID() })).status).toBe(404);
    } finally { await adminContext.close(); }
    await member.reload();
    expect(memberChat.operations.listReplies.out.parse((await request(member, `${path}/${root.message.id}/replies`)).data).items).toContainEqual(reply);
    const persisted = await audit(client => client.query("SELECT id::text,sequence::int,author_id,text,thread_root_id::text,stage_reference FROM project_member_chat_messages WHERE org_id=$1 AND project_id=$2 ORDER BY sequence", [FULLSTACK_E2E.collaborationOrgId, projectId]));
    expect(persisted.rows).toHaveLength(15);
    expect(persisted.rows[0]).toMatchObject({ id: root.message.id, author_id: FULLSTACK_E2E.collaborationLeadUserId, text: input.text, thread_root_id: null });
    expect(persisted.rows[1]).toMatchObject({ id: reply.id, author_id: FULLSTACK_E2E.collaborationMemberUserId, thread_root_id: root.message.id });
    const removed = await request(page, `/projects/${projectId}/collaborators/${FULLSTACK_E2E.collaborationMemberUserId}`, "DELETE");
    expect(removed.status).toBeLessThan(300);
    // A still-authenticated old session must re-check actual project membership.
    expect((await request(member, path)).status).toBe(404);
    expect((await request(member, path, "POST", { ...input, clientMessageId: randomUUID() })).status).toBe(404);
    await addMember(page, projectId);
    const after = await modelActivity(projectId);
    expect(after).toEqual(before);
    expect((await request(page, `/projects/${projectId}/archive`, "POST", { projectId })).status).toBeLessThan(300);
    const archived = memberChat.operations.listMessages.out.parse((await request(member, path)).data);
    expect(archived).toMatchObject({ canWrite: false, readOnlyReason: "archived" });
    const blocked = await request(member, path, "POST", { ...input, clientMessageId: randomUUID() });
    expect(blocked.status).toBe(403);
    expect(JSON.stringify(blocked.data)).toContain("READ_ONLY_ARCHIVED");
    const evidence = test.info().outputPath("member-chat-pg-readback.json");
    await writeFile(evidence, JSON.stringify({ projectId, persisted: persisted.rows, modelActivity: { before, after }, topicGeometry }, null, 2));
    await test.info().attach("member-chat-pg-readback", { path: evidence, contentType: "application/json" });
  } finally { await memberContext.close(); }
});

test("saved AIDT report confirms a frozen version and exports that version after a newer draft", async ({ page }) => {
  test.skip(!isAidtModuleEnabled() || !enabled(process.env.ENABLE_AIDT_MODULE), "Optional AIDT must be enabled.");
  test.setTimeout(120_000);
  await login(page);
  const projectId = await createProject(page, "小组报告确认回归");
  const stagePath = (stage: number) => `/projects/${projectId}/aidt/stages/${stage}`;
  const source = { stageId: 1, revision: 1 };
  const first = { projectId, stageId: 1, operationId: randomUUID(), expectedRevision: 0, content: draft("已保存研究问题"), sourceStageRevisions: [] };
  expect((await request(page, stagePath(1), "PUT", first)).status).toBe(200);
  const markdown = "# 小组报告\n本轮尚未开展真实测试。";
  const reportDraft = { markdown, sourceStageRevisions: [source] };
  const sixth = { ...first, stageId: 6, operationId: randomUUID(), content: { ...draft("等待验证"), summaryReport: reportDraft } };
  expect((await request(page, stagePath(6), "PUT", sixth)).status).toBe(200);

  await page.goto(`/aidt/${projectId}?step=6&tool=report`);
  await expect(page.getByTestId("aidt-report-save-state")).toHaveText("小组报告已保存 · 待确认");
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  await page.getByRole("button", { name: "确认审阅此版本" }).click();
  await page.getByRole("button", { name: "确认小组报告", exact: true }).click();
  await expect(page.getByTestId("aidt-report-save-state")).toHaveText("小组报告已确认 · V2");
  const confirmed = stages.operations.get.out.parse((await request(page, stagePath(6))).data).stage;
  expect(confirmed?.content.summaryReport).toEqual({ ...reportDraft, confirmedAtRevision: 2 });

  await page.getByRole("button", { name: "编辑报告", exact: true }).click();
  await page.getByLabel("小组报告草稿", { exact: true }).fill("# 后续草稿：仍待审阅");
  await page.getByTestId("aidt-report-save").click();
  await expect(page.getByTestId("aidt-report-save-state")).toHaveText("小组报告已保存 · 待确认");
  await page.getByText("已确认版本与导出", { exact: true }).click();
  await page.getByRole("button", { name: "读取版本历史", exact: true }).click();
  await page.getByRole("button", { name: /查看确认版 V2/ }).click();
  await expect(page.getByRole("article", { name: "已确认报告正文" })).toContainText("本轮尚未开展真实测试。");
  await page.getByRole("button", { name: "查看第 1 步 V1", exact: true }).click();
  await expect(page.getByLabel("来源版本详情")).toContainText("已保存研究问题");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 V2 Markdown", exact: true }).click();
  const exported = await download;
  const file = test.info().outputPath("confirmed-report-v2.md");
  await exported.saveAs(file);
  const bytes = await readFile(file, "utf8");
  expect(bytes).toContain(markdown);
  expect(bytes).toContain("第 1 步 V1");
  expect(bytes).not.toContain("后续草稿");
});
