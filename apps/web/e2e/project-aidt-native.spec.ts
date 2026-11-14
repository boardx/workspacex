import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chat, skills as skillContracts } from "@repo/contracts";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { sendViaWorkbench, type PersistedMessage } from "./chat-v2-send";

async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/__fullstack_api${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("wsx.sessionToken")}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }, { path, method, body });
}
async function login(page: Page, member = false) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(member ? FULLSTACK_E2E.memberEmail : FULLSTACK_E2E.leadEmail);
  await page.getByTestId("login-password").fill(member ? FULLSTACK_E2E.memberPassword : FULLSTACK_E2E.leadPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
}

test("AIDT native project: dashboard, durable Chat, real resource association, recorder and readonly/access boundaries", async ({ page, browser }) => {
  test.skip(!isAidtModuleEnabled(), "AIDT is optional; run this lane only with an explicitly enabled AIDT Web build and API bootstrap.");
  test.setTimeout(240_000);
  await login(page);
  // AIDT is explicitly selected at creation; ordinary projects remain ordinary.
  await page.getByTestId("rail-aidt").click();
  await expect(page).toHaveURL(/\/aidt$/);
  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill(`食堂体验探索 ${randomUUID().slice(0, 8)}`);
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  const projectList = await api(page, `/projects?orgId=${FULLSTACK_E2E.orgId}`);
  const savedProject = projectList.data.find((it: { id: string }) => it.id === projectId);
  expect(savedProject.kind).toBe("general");
  expect(savedProject.tags).toContain("workspacex:aidt");
  await page.goto("/home");
  await expect(page.getByTestId(`home-recent-project-${projectId}`)).toBeVisible();
  await page.getByTestId(`home-recent-project-${projectId}`).click();
  await expect(page).toHaveURL(new RegExp(`/aidt/${projectId}$`));
  await expect(page.getByTestId("aidt-dashboard")).toBeVisible();
  const base = `/aidt/${projectId}?`;
  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}`)).toBeVisible();
  await expect(page.getByTestId(`projects-card-${projectId}`)).toHaveCount(0);
  await page.getByTestId("rail-aidt").click();
  await page.screenshot({ path: test.info().outputPath("aidt-home.png"), fullPage: true });
  await page.getByTestId(`aidt-project-${projectId}`).click();
  await expect(page.getByTestId("aidt-dashboard")).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 375) await expect(page.getByTestId("mobile-tab-aidt")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`aidt-dashboard-${width}.png`), fullPage: true });
  }
  await page.getByTestId("aidt-step-1").click();
  await expect(page.getByTestId("aidt-native-chat")).toBeVisible();
  await expect(page.getByTestId("aidt-learning-start")).toContainText("本组先想一想");
  await expect(page.getByText("调研市场并产出带来源的报告", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-1-start.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await expect(page.getByRole("heading", { name: "本组先想一想" })).toBeInViewport({ ratio: 0.8 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-mobile-start.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // UI v2 forms are page drafts, while native Chat remains the real save path.
  await expect(page.getByTestId("aidt-open-output")).toHaveAttribute("href", /thread=/);
  const draftThreadId = new URL(page.url()).searchParams.get("thread")!;
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  await page.getByLabel("初始问题", { exact: true }).fill("本页草稿：改善校园午餐排队");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v2-problem-sheet.png"), fullPage: true });
  const beforeDraftSent = await api(page, `/chat/threads/${draftThreadId}/messages?limit=100`);
  expect(beforeDraftSent.data.messages).toHaveLength(0);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v2-mobile-sheet.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "关闭工具，回到对话" }).click();
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue("本页草稿：改善校园午餐排队");
  await page.getByRole("button", { name: "审阅并发送到本步聊天", exact: true }).click();
  await expect(page.getByTestId("aidt-tool-panel")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue(/本页草稿：改善校园午餐排队/);
  const afterOffer = await api(page, `/chat/threads/${draftThreadId}/messages?limit=100`);
  expect(afterOffer.data.messages).toHaveLength(0); // preparing a draft never sends it
  await page.getByTestId("aidt-open-output").click();
  await page.getByRole("button", { name: "审阅并发送到本步聊天", exact: true }).click();
  await expect(page.getByTestId("aidt-tool-panel").getByRole("status")).toContainText("未覆盖");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-outcome.png"), fullPage: true });
  await page.getByRole("link", { name: "六步 Dashboard", exact: false }).click();
  await expect(page.getByTestId("aidt-step-1")).toContainText("本页草稿 · 1 项已填写");
  await expect(page.getByTestId("aidt-materials")).toContainText("当前没有已关联资料");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-dashboard.png"), fullPage: true });
  await page.getByTestId("aidt-step-1").click();
  const prompt = "我们先讨论学校食堂排队的问题，研究午休时间较短的学生。请先问我一个澄清问题，不要替小组做决定。";
  const wire = await sendViaWorkbench(page, prompt);
  expect(JSON.stringify(wire.postDataJSON().context)).toContain("AIDT");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBeTruthy();
  const threadId = new URL(page.url()).searchParams.get("thread")!;
  // This fullstack lane uses its explicit same-origin API prefix; the chat-read
  // lane's unprefixed page.request helper targets a different rewrite surface.
  await expect.poll(async () => {
    const out = await api(page, `/chat/threads/${encodeURIComponent(threadId)}/messages?limit=100`);
    const messages = out.data.messages ?? [];
    return {
      status: out.status,
      human: messages.some((message: PersistedMessage) => message.authorKind === "human" && message.text === prompt),
      assistant: messages.some((message: PersistedMessage) => message.authorKind === "agent" && message.agentRunId !== null && message.text.trim().length > 0),
    };
  }, { timeout: 60_000 }).toEqual({ status: 200, human: true, assistant: true });
  await expect(page).toHaveURL(/\/aidt\//);
  await page.screenshot({ path: test.info().outputPath("aidt-native-chat.png"), fullPage: true });
  await page.getByRole("link", { name: /2\. 共情/ }).click();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).not.toBe(threadId);
  await expect(page.getByTestId("aidt-learning-start")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-2-start.png"), fullPage: true });
  await page.getByRole("link", { name: "阶段交接", exact: true }).click();
  await expect(page.getByTestId("aidt-stage-bridge")).toContainText("问题聚焦单");
  await page.getByTestId("aidt-stage-bridge").locator("summary").click();
  await expect(page.getByTestId("aidt-stage-bridge")).toContainText("本页草稿：改善校园午餐排队");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-bridge.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "关闭工具，回到对话" }).click();
  const empathyThreadId = new URL(page.url()).searchParams.get("thread")!;
  expect(empathyThreadId).toBeTruthy();
  // Server read-back confirms actual, different skills mounted on separate durable threads.
  const skills = await api(page, `/skills?orgId=${FULLSTACK_E2E.orgId}&entry=library`);
  const catalog = skills.data.items;
  const understandSkill = catalog.find((it: { platformStableName: string }) => it.platformStableName === "aidt-understand");
  const empathySkill = catalog.find((it: { platformStableName: string }) => it.platformStableName === "aidt-empathize");
  const firstMounts = await api(page, `/threads/${threadId}/skill-deviations?projectId=${projectId}`);
  const secondMounts = await api(page, `/threads/${empathyThreadId}/skill-deviations?projectId=${projectId}`);
  expect(firstMounts.data.temporary).toContainEqual(expect.objectContaining({ skillId: understandSkill.skillId, removedAt: null }));
  expect(secondMounts.data.temporary).toContainEqual(expect.objectContaining({ skillId: empathySkill.skillId, removedAt: null }));
  const stageThreads = new Set([threadId, empathyThreadId]);
  for (const [number, title, stableName] of [[3, "综合与定义", "aidt-define"], [4, "创意探索", "aidt-ideate"], [5, "制作原型", "aidt-prototype"], [6, "测试与迭代", "aidt-iterate"]] as const) {
    await page.getByRole("link", { name: `${number}. ${title}`, exact: true }).click();
    await expect(page.getByTestId("aidt-step-skill")).toContainText(title);
    const currentThread = new URL(page.url()).searchParams.get("thread")!;
    expect(currentThread).toBeTruthy();
    expect(stageThreads.has(currentThread)).toBe(false);
    stageThreads.add(currentThread);
    const skill = catalog.find((it: { platformStableName: string }) => it.platformStableName === stableName);
    const mounted = await api(page, `/threads/${currentThread}/skill-deviations?projectId=${projectId}`);
    expect(mounted.data.temporary).toContainEqual(expect.objectContaining({ skillId: skill.skillId, removedAt: null }));
    await expect(page.getByTestId("copilotkit-v2-thread-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("aidt-learning-start")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`aidt-teaching-step-${number}-start.png`), fullPage: true });
    if (number === 4) {
      await page.getByTestId("aidt-open-output").click();
      await page.getByLabel("候选1名称", { exact: true }).fill("错峰取餐界面");
      await page.getByLabel("候选1核心说明", { exact: true }).fill("向学生展示取餐时间窗口。用静态界面先讨论是否容易理解。");
      await page.getByRole("button", { name: "移除候选 3" }).click();
      await page.getByRole("button", { name: "移除候选 2" }).click();
      await page.getByRole("radio").check();
      await page.getByLabel("候选1参考图", { exact: true }).setInputFiles({ name: "ui-reference.webp", mimeType: "image/webp", buffer: await readFile(resolve(dirname(test.info().file), "../../home/assets/img/aidt-cocreation-640.webp")) });
      await expect(page.getByAltText("候选1参考图（未上传）")).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(1);
      await page.getByTestId("aidt-tool-panel").evaluate((element) => { element.scrollTop = 0; });
      await page.screenshot({ path: test.info().outputPath("aidt-ui-v2-idea-sheet.png"), fullPage: true });
      const noIdeaSave = await api(page, `/chat/threads/${currentThread}/messages?limit=100`);
      expect(noIdeaSave.data.messages).toHaveLength(0);
      await page.getByRole("link", { name: "关闭工具，回到对话" }).click();
    }

  }
  expect(stageThreads.size).toBe(6);
  await page.getByTestId("aidt-open-report").click();
  await expect(page.getByTestId("aidt-report-preview")).toBeVisible();
  const reportEditor = page.getByLabel("小组报告草稿", { exact: true });
  await expect(reportEditor).toHaveValue(/本页草稿：改善校园午餐排队/);
  await expect(reportEditor).toHaveValue(/错峰取餐界面/);
  const draftReport = await reportEditor.inputValue();
  await reportEditor.fill(`${draftReport}\n本组本页审阅备注：尚未真实测试。`);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown 草稿" }).click();
  const downloaded = await downloading;
  const reportFile = test.info().outputPath("aidt-ui-v2-report.md");
  await downloaded.saveAs(reportFile);
  const reportBytes = await readFile(reportFile, "utf8");
  expect(reportBytes).toContain("UI 审阅稿");
  expect(reportBytes).toContain("尚未真实测试");
  expect(reportBytes).toContain("待教师提供");
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  await page.getByTestId("aidt-tool-panel").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v2-report-preview.png"), fullPage: true });
  await page.getByRole("link", { name: "关闭工具，回到对话" }).click();

  await page.getByRole("link", { name: /2\. 共情/ }).click();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await page.reload();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(empathyThreadId);
  await page.getByRole("link", { name: /1\. 理解/ }).click();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(threadId);
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /2\. 共情/ }).click();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await page.getByText("资料与工具", { exact: true }).click();
  await page.getByRole("link", { name: "个人录音笔记", exact: true }).click();
  await expect(page.getByTestId("rec-history-page")).toBeVisible();
  await expect(page.getByTestId("aidt-native-chat")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-recording-panel.png"), fullPage: true });
  // This checks reuse and real reads only: no actual microphone or real ASR claim.
  const transcript = await api(page, "/recording/realtime-asr/sessions", "POST", { name: "AIDT self reflection", tags: [] });
  expect(transcript.status).toBeLessThan(300);
  const resourceId = transcript.data.sessionId;
  const linked = await api(page, `/projects/${projectId}/resources`, "POST", { projectId, kind: "personal_transcription", resourceId });
  expect(linked.status, JSON.stringify(linked.data)).toBeLessThan(300);
  const listed = await api(page, `/projects/${projectId}/resources`);
  expect(listed.data.items).toContainEqual(expect.objectContaining({ id: resourceId, kind: "personal_transcription" }));
  await page.goto(`${base}step=2&tool=transcript`);
  await expect(page.getByText("AIDT self reflection", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-native-project-resources.png"), fullPage: true });
  // Show failed reads as failures: browser transport fault, actual API data above remained real.
  await page.route(`**/projects/${projectId}/resources`, (route) => route.abort());
  await page.goto(`${base}step=5&tool=design&resource=missing`);
  await expect(page.getByTestId("aidt-resource-error")).toBeVisible();
  await page.unroute(`**/projects/${projectId}/resources`);
  // Round10: actual two-person group collaboration, with a separate browser/session.
  const memberAdded = await api(page, `/projects/${projectId}/collaborators`, "POST", { projectId, userId: FULLSTACK_E2E.memberUserId, role: "collaborator" });
  expect(memberAdded.status, JSON.stringify(memberAdded.data)).toBeLessThan(300);
  await page.goto(`${base}step=1`);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
  await page.getByText("本组成员与可见范围", { exact: true }).click();
  await expect(page.getByTestId(`project-collaborator-${FULLSTACK_E2E.memberUserId}`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-group-members.png"), fullPage: true });
  await page.getByText("本组成员与可见范围", { exact: true }).click();
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
  try {
    const second = await secondContext.newPage();
    await login(second, true);
    await second.goto(`${base}step=1`);
    await expect(second.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
    await expect.poll(() => new URL(second.url()).searchParams.get("thread")).toBe(threadId);
    await expect(second.getByText(prompt, { exact: true }).first()).toBeVisible();
    const studentMessage = "本地测试消息：组员共同讨论。仅验证共享保存，不作为真实研究证据。";
    await sendViaWorkbench(second, studentMessage);
    await expect.poll(async () => {
      const out = await api(second, `/chat/threads/${threadId}/messages?limit=100`);
      return out.data.messages.some((m: PersistedMessage & { authorId: string }) => m.authorKind === "human" && m.authorId === FULLSTACK_E2E.memberUserId && m.text === studentMessage);
    }).toBe(true);
    await page.goto(`${base}step=1`);
    await expect(page.getByText(studentMessage, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("aidt-group-shared-chat.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("aidt-group-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    // A second group uses a distinct real project permission container.
    await page.goto("/aidt");
    await page.getByTestId("aidt-new").click();
    await page.getByTestId("project-new-name").fill("另一组 · 独立空间");
    await page.getByTestId("project-new-create").click();
    await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
    const otherGroupUrl = page.url();
    await second.goto(otherGroupUrl);
    await expect(second.getByTestId("aidt-access-denied")).toBeVisible();
    // The teacher/operator's private conversation must not become group consensus.
    const createdPrivate = await api(page, chat.operations.mutateThread.path, "POST", { op: "create", projectId, threadId: null, groupId: null, title: "个人思考·不要共享", visibilityScope: "private", expectedVersion: null, reason: null });
    expect(createdPrivate.status, JSON.stringify(createdPrivate.data)).toBeLessThan(300);
    const privateId = createdPrivate.data.threadId;
    const before = await api(page, `/threads/${privateId}/skill-deviations?projectId=${projectId}`);
    const mounted = await api(page, skillContracts.operations.mountSkillToThread.path.replace(":threadId", privateId), "POST", { threadId: privateId, skillIds: [understandSkill.skillId], expectedVersion: before.data.version });
    expect(mounted.status, JSON.stringify(mounted.data)).toBeLessThan(300);
    await page.goto(`${base}step=1&thread=${privateId}`);
    await expect(page.getByTestId("aidt-chat-error")).toContainText("个人范围");
    const privateRead = await api(second, `/chat/threads/${privateId}?projectId=${projectId}`);
    expect([403, 404]).toContain(privateRead.status);
    // Two first-open requests can create two native threads: surface a choice, never silently merge.
    const duplicate = await api(page, chat.operations.mutateThread.path, "POST", { op: "create", projectId, threadId: null, groupId: null, title: "同组并发创建的第二条", visibilityScope: "plenary", expectedVersion: null, reason: null });
    expect(duplicate.status).toBeLessThan(300);
    const duplicateId = duplicate.data.threadId;
    const duplicateBefore = await api(page, `/threads/${duplicateId}/skill-deviations?projectId=${projectId}`);
    const duplicateMount = await api(page, skillContracts.operations.mountSkillToThread.path.replace(":threadId", duplicateId), "POST", { threadId: duplicateId, skillIds: [understandSkill.skillId], expectedVersion: duplicateBefore.data.version });
    expect(duplicateMount.status).toBeLessThan(300);
    await page.goto(`${base}step=1`);
    await expect(page.getByTestId("aidt-chat-error")).toContainText("多个本步对话");
    await expect(page.getByRole("link", { name: /继续这条对话/ })).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath("aidt-group-conflict.png"), fullPage: true });
  } finally { await secondContext.close(); }
  // Fixture-only membership removal restores the original nonmember counterproof below.
  const removed = await api(page, `/projects/${projectId}/collaborators/${FULLSTACK_E2E.memberUserId}`, "DELETE");
  expect(removed.status, JSON.stringify(removed.data)).toBeLessThan(300);
  const archived = await api(page, `/projects/${projectId}/archive`, "POST", { projectId });
  expect(archived.status, JSON.stringify(archived.data)).toBeLessThan(300);
  await page.goto(`${base}step=2&tool=record`);
  await expect(page.getByTestId("aidt-readonly")).toBeVisible();
  await expect(page.getByTestId("rec-history-page")).toHaveCount(0);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, true);
  await page.goto(`${base}step=1`);
  await expect(page.getByTestId("aidt-access-denied")).toBeVisible();
  await expect(page.getByTestId("aidt-workspace")).toHaveCount(0);
});
