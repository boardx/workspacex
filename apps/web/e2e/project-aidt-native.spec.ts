import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chat, skills as skillContracts } from "@repo/contracts";
import { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
import { isProjectMemberChatEnabled } from "@/lib/project-member-chat-config";
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

/** Keep acceptance on the real compact/mobile navigation and optional assistant. */
async function selectStage(page: Page, stage: number) {
  const desktop = page.getByTestId(`aidt-stage-desktop-${stage}`);
  if (await desktop.isVisible()) await desktop.click();
  else {
    const picker = page.getByTestId("aidt-mobile-steps");
    if ((await picker.getAttribute("open")) === null) await picker.locator("summary").first().click();
    await page.getByTestId(`aidt-stage-mobile-${stage}`).click();
  }
}
async function openAssistant(page: Page, expectedChatError = false) {
  const panel = page.getByTestId("aidt-assistant-panel");
  const trigger = page.getByRole("button", { name: "AI 引导师", exact: true });
  // A route change can finish before its authenticated workspace is mounted.
  // Default Chat already occupies the panel; only tool views have a trigger.
  await expect.poll(async () => await panel.isVisible() || await trigger.isVisible()).toBe(true);
  if (!(await panel.isVisible())) await trigger.click();
  await expect(panel).toBeVisible();
  if (expectedChatError) return;
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toBeVisible();
  await expect(composer).toBeInViewport({ ratio: 0.8 });
  await expect.poll(() => composer.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === node || node.contains(hit);
  })).toBe(true);
}
async function openGuidance(page: Page) {
  const scaffold = page.getByTestId("aidt-input-scaffold");
  if (!(await scaffold.isVisible())) {
    await page.getByText("不知道怎么开始？", { exact: true }).click();
  }
  await expect(scaffold).toBeVisible();
}
async function openStageTools(page: Page) {
  const tools = page.getByTestId("aidt-tools");
  if ((await tools.getAttribute("open")) === null) await tools.locator(":scope > summary").click();
}
async function openPersonalCheckpoints(page: Page) {
  if (await page.getByTestId("aidt-tools").count()) await openStageTools(page);
  const advanced = page.getByTestId("aidt-personal-checkpoints").locator("xpath=ancestor::details[1]");
  if ((await advanced.getAttribute("open")) === null) await advanced.locator(":scope > summary").click();
  const details = page.getByTestId("aidt-checkpoint-details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
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
  await expect(page.getByTestId("aidt-dashboard")).toBeVisible();
  const base = `/aidt/${projectId}?`;
  await page.goto("/projects");
  await expect(page.getByTestId(`projects-card-${FULLSTACK_E2E.projectId}`)).toBeVisible();
  await expect(page.getByTestId(`projects-card-${projectId}`)).toHaveCount(0);
  await page.getByTestId("rail-aidt").click();
  await page.screenshot({ path: test.info().outputPath("aidt-home.png"), fullPage: true });
  await page.getByTestId(`aidt-project-${projectId}`).click();
  await expect(page).toHaveURL(new RegExp(`/aidt/${projectId}$`));
  await expect(page.getByTestId("aidt-dashboard")).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 375) await expect(page.getByTestId("mobile-tab-aidt")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`aidt-dashboard-${width}.png`), fullPage: true });
  }
  await page.getByTestId("aidt-step-1").click();
  await expect(page.getByTestId("aidt-stage-output")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await openGuidance(page);
  await expect(page.getByTestId("aidt-input-scaffold")).toContainText("原始命题");
  await expect(page.getByText("调研市场并产出带来源的报告", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-1-start.png"), fullPage: true });
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  await expect(page.getByTestId("aidt-assistant-panel")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByLabel("初始问题", { exact: true })).toBeVisible();
  await openAssistant(page);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await page.getByTestId("copilotkit-v2-input").fill("尚未发送的移动端对话草稿");
  const mobileSend = page.getByTestId("copilotkit-v2-send");
  await expect(mobileSend).toBeEnabled();
  await expect(mobileSend).toBeInViewport({ ratio: 0.8 });
  expect(await mobileSend.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === node || node.contains(hit);
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-mobile-start.png"), fullPage: true });
  if (isProjectMemberChatEnabled()) {
    // The human conversation remains usable above the mobile AI panel.
    await page.getByTestId("global-member-chat-open").click();
    await expect(page.getByTestId("project-member-input")).toBeInViewport({ ratio: 0.8 });
    await page.getByTestId("project-member-input").fill("与AI草稿分开的成员讨论草稿");
    expect(await page.getByTestId("project-member-input").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === node || node.contains(hit);
    })).toBe(true);
    await page.screenshot({ path: test.info().outputPath("aidt-mobile-ai-with-member-chat.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("global-member-chat-panel")).not.toBeVisible();
    await expect(page.getByTestId("aidt-assistant-panel")).toBeVisible();
    await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue("尚未发送的移动端对话草稿");
  }
  await page.getByRole("button", { name: "关闭 AI 引导师", exact: true }).click();
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  await expect(page.getByLabel("初始问题", { exact: true })).toBeVisible();
  await openAssistant(page);
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue("尚未发送的移动端对话草稿");
  await page.getByTestId("copilotkit-v2-input").fill("");
  await page.getByRole("button", { name: "关闭 AI 引导师", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  // Editing and offering a form do not send messages or save a checkpoint.
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  const draftThreadId = new URL(page.url()).searchParams.get("thread")!;
  expect(draftThreadId).toBeTruthy();
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
  await expect(page.getByTestId("aidt-tool-panel").getByRole("status").filter({ hasText: "未覆盖" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-outcome.png"), fullPage: true });
  await page.getByRole("link", { name: "六步研究", exact: false }).click();
  await expect(page.getByTestId("aidt-step-1")).toContainText("本页有未保存内容");
  await expect(page.getByTestId("aidt-materials")).toContainText("当前没有已关联资料");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-dashboard.png"), fullPage: true });
  await page.getByTestId("aidt-step-1").click();
  const prompt = "我们先讨论学校食堂排队的问题，研究午休时间较短的学生。请先问我一个澄清问题，不要替小组做决定。";
  await openAssistant(page);
  const wire = await sendViaWorkbench(page, prompt);
  const selector = AidtContextSelector.parse(wire.postDataJSON().forwardedProps?.aidtContext);
  expect(selector).toMatchObject({ projectId, purpose: "stage", stageId: 1 });
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
  // Reuse the signed native Artifact draft path, with an explicit real human
  // source. The checkpoint is personal; it is not a group-confirmed outcome.
  const messagesBeforeCheckpoint = await api(page, `/chat/threads/${threadId}/messages?limit=100`);
  const sourceMessage = messagesBeforeCheckpoint.data.messages.find((message: PersistedMessage & { id: string }) => message.authorKind === "human" && message.text === prompt);
  expect(sourceMessage?.id).toBeTruthy();
  await page.getByTestId("aidt-open-output").click();
  await openPersonalCheckpoints(page);
  await page.getByTestId("aidt-checkpoint-reload").click();
  await expect(page.getByTestId("aidt-checkpoint-source").locator(`option[value="${sourceMessage.id}"]`)).toHaveCount(1);
  await page.getByTestId("aidt-checkpoint-source").selectOption(sourceMessage.id);
  const checkpointLanding = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes(`/chat/threads/${threadId}/artifacts`));
  await page.getByTestId("aidt-checkpoint-save").click();
  const checkpointResponse = await checkpointLanding;
  expect(checkpointResponse.ok()).toBe(true);
  const checkpointArtifactId: string = (await checkpointResponse.json()).artifactId;
  await expect(page.getByTestId("aidt-checkpoint-receipt")).toContainText("已回读确认");
  await expect(page.getByTestId("aidt-checkpoint-receipt")).toContainText("仅自己可见，小组未同步");
  const checkpointSource = await api(page, `/chat/threads/${threadId}/artifacts/${checkpointArtifactId}/source?projectId=${projectId}`);
  expect(checkpointSource.status).toBe(200);
  expect(checkpointSource.data.immutableRevision).toMatch(/^artifact-v1:[1-9][0-9]*$/);
  expect(JSON.parse(checkpointSource.data.markdown)).toMatchObject({ sourceMessageId: sourceMessage.id, stageId: 1, visibility: "personal-draft", contentOrigin: "student-authored-unverified" });
  const messagesAfterCheckpoint = await api(page, `/chat/threads/${threadId}/messages?limit=100`);
  expect(messagesAfterCheckpoint.data.messages).toHaveLength(messagesBeforeCheckpoint.data.messages.length);
  await page.screenshot({ path: test.info().outputPath("aidt-personal-checkpoint-receipt.png"), fullPage: true });
  await page.reload();
  await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue("");
  const restoredCheckpointDetails = page.getByTestId("aidt-checkpoint-details");
  // Resolving the authenticated thread deliberately remounts scope-bound UI.
  // Open after its server read settles, so an early click cannot hit the old scope.
  await expect(restoredCheckpointDetails.locator("summary")).toContainText("1 份服务器保存稿");
  await openPersonalCheckpoints(page);
  const checkpointSelect = page.getByTestId("aidt-checkpoint-select");
  await expect(checkpointSelect).toBeVisible();
  await checkpointSelect.selectOption(JSON.stringify([checkpointArtifactId, checkpointSource.data.immutableRevision]));
  await page.getByTestId("aidt-checkpoint-restore").click();
  await expect(page.getByLabel("初始问题", { exact: true })).toHaveValue("本页草稿：改善校园午餐排队");
  await expect(page.getByTestId("aidt-checkpoint-restore-notice")).toContainText("尚未同步给小组");
  await page.getByRole("link", { name: "关闭工具，回到对话" }).click();
  await selectStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).not.toBe(threadId);
  await openGuidance(page);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-2-start.png"), fullPage: true });
  await openStageTools(page);
  await page.getByRole("link", { name: "阶段交接", exact: true }).click();
  await expect(page.getByTestId("aidt-stage-bridge")).toContainText("工作坊主题命题");
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
  for (const [number, stableName] of [[3, "aidt-define"], [4, "aidt-ideate"], [5, "aidt-prototype"], [6, "aidt-iterate"]] as const) {
    const skill = catalog.find((it: { platformStableName: string }) => it.platformStableName === stableName);
    await selectStage(page, number);
    await openAssistant(page);
    await expect(page.getByTestId("aidt-step-skill")).toHaveText(skill.name);
    const currentThread = new URL(page.url()).searchParams.get("thread")!;
    expect(currentThread).toBeTruthy();
    expect(stageThreads.has(currentThread)).toBe(false);
    stageThreads.add(currentThread);
    const mounted = await api(page, `/threads/${currentThread}/skill-deviations?projectId=${projectId}`);
    expect(mounted.data.temporary).toContainEqual(expect.objectContaining({ skillId: skill.skillId, removedAt: null }));
    await expect(page.getByTestId("copilotkit-v2-thread-sidebar")).toHaveCount(0);
    await openGuidance(page);
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
  await page.getByRole("button", { name: "引用与产物", exact: true }).click();
  await page.getByRole("link", { name: "展开报告", exact: true }).click();
  await expect(page.getByTestId("aidt-report-preview")).toBeVisible();
  await page.getByRole("button", { name: "编辑报告", exact: true }).click();
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
  expect(reportBytes).toContain("小组研究报告 · 学生审阅稿");
  expect(reportBytes).toContain("尚未真实测试");
  expect(reportBytes).toContain("待教师提供");
  await page.getByRole("button", { name: "阅读预览", exact: true }).click();
  await page.getByTestId("aidt-tool-panel").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v2-report-preview.png"), fullPage: true });
  await page.getByRole("link", { name: "关闭工具，回到对话" }).click();

  await selectStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await page.reload();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(empathyThreadId);
  await selectStage(page, 1);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(threadId);
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
  await selectStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await openStageTools(page);
  await page.getByRole("link", { name: "个人录音笔记", exact: true }).click();
  await expect(page.getByTestId("rec-history-page")).toBeVisible();
  await expect(page.getByTestId("aidt-native-chat")).toBeAttached();
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
  await page.goto(`/aidt/${projectId}`);
  const groupMembers = page.getByTestId("aidt-group-members");
  await groupMembers.locator("summary").click();
  await expect(groupMembers.getByTestId(`project-collaborator-${FULLSTACK_E2E.memberUserId}`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-group-members.png"), fullPage: true });
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
  try {
    const second = await secondContext.newPage();
    await login(second, true);
    await second.goto(`${base}step=1`);
    await openAssistant(second);
    await expect(second.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
    await expect.poll(() => new URL(second.url()).searchParams.get("thread")).toBe(threadId);
    await expect(second.getByText(prompt, { exact: true }).first()).toBeVisible();
    const memberCheckpointList = await api(second, `/chat/threads/${threadId}/artifacts?projectId=${projectId}`);
    expect(memberCheckpointList.status).toBe(200);
    expect(memberCheckpointList.data.items.some((item: { artifactId: string }) => item.artifactId === checkpointArtifactId)).toBe(false);
    const memberCheckpointSource = await api(second, `/chat/threads/${threadId}/artifacts/${checkpointArtifactId}/source?projectId=${projectId}`);
    expect([403, 404]).toContain(memberCheckpointSource.status);
    const studentMessage = "本地测试消息：组员共同讨论。仅验证共享保存，不作为真实研究证据。";
    await sendViaWorkbench(second, studentMessage);
    await expect.poll(async () => {
      const out = await api(second, `/chat/threads/${threadId}/messages?limit=100`);
      return out.data.messages.some((m: PersistedMessage & { authorId: string }) => m.authorKind === "human" && m.authorId === FULLSTACK_E2E.memberUserId && m.text === studentMessage);
    }).toBe(true);
    await page.goto(`${base}step=1`);
    await openAssistant(page);
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
    await openAssistant(page, true);
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
    await openAssistant(page, true);
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
