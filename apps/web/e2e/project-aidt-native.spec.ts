import { problemDiscussion, problemInitial, problemRevision } from "../../api/scripts/loopback-aidt-problem";
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

async function createProblem(page: Page, title: string) {
  await page.getByTestId("aidt-new-entity-card").click();
  const dialog = page.getByRole("dialog", { name: "新建问题" });
  await dialog.getByRole("textbox", { name: "问题名称", exact: true }).fill(title);
  await dialog.getByRole("button", { name: "创建问题", exact: true }).click();
  const card = page.getByRole("link", { name: title, exact: true });
  await expect(card).toBeVisible();
  return card;
}

/** Legacy aggregate tools have an explicit product entry; entity routes are tested separately. */
async function openHistoryTools(page: Page) {
  if (new URL(page.url()).searchParams.get("history") === "1") {
    await expect(page.getByTestId("aidt-workspace")).toBeVisible();
    return;
  }
  await expect(page.getByTestId("aidt-step-entity-directory")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveCount(0);
  await page.getByRole("link", { name: "打开早期阶段对话", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("history")).toBe("1");
}

/** Preserve compact/mobile navigation while explicitly entering supported aggregate tools. */
async function selectHistoryStage(page: Page, stage: number) {
  if (new URL(page.url()).searchParams.has("entity")) {
    await page.getByRole("link", { name: /^返回(产物|访谈|问题)列表$/ }).click();
    await expect(page.getByTestId("aidt-step-entity-directory")).toBeVisible();
    await page.getByRole("link", { name: "项目总览", exact: true }).click();
    await page.getByTestId(`aidt-step-${stage}`).click();
    await openHistoryTools(page);
    return;
  }
  if (new URL(page.url()).searchParams.get("step") === "1") {
    await page.getByRole("link", { name: "项目总览" }).click();
    await page.getByTestId(`aidt-step-${stage}`).click();
    await openHistoryTools(page);
    return;
  }
  const desktop = page.getByTestId(`aidt-stage-desktop-${stage}`);
  if (await desktop.isVisible()) await desktop.click();
  else {
    const picker = page.getByTestId("aidt-mobile-steps");
    if ((await picker.getAttribute("open")) === null) await picker.locator("summary").first().click();
    await page.getByTestId(`aidt-stage-mobile-${stage}`).click();
  }
  await openHistoryTools(page);
}
async function closeTools(page: Page) {
  const close = page.getByTestId("chat-task-workbench-inspector-collapse");
  if (await close.isVisible()) await close.click();
  await expect(page.getByTestId("aidt-tool-panel")).toHaveCount(0);
}
async function openOutcome(page: Page) {
  if (new URL(page.url()).searchParams.has("entity")) {
    if (!await page.getByTestId("aidt-stage-output").isVisible()) {
      const mobile = page.getByTestId("chat-task-workbench-mobile-open");
      if (await mobile.isVisible()) await mobile.click();
      await page.getByRole("tab", { name: "产物" }).click();
    }
    await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
    return;
  }
  if (!(await page.getByTestId("aidt-open-output").isVisible())) {
    const mobile = page.getByTestId("chat-task-workbench-mobile-open");
    if (await mobile.isVisible()) await mobile.click();
    else {
      const host = page.getByTestId("chat-task-workbench-host-open");
      if (await host.isVisible()) await host.click();
      else await page.getByRole("tab", { name: "产物" }).click();
    }
  }
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
}
async function openMaterials(page: Page) {
  await openOutcome(page);
  await page.getByRole("link", { name: "资料", exact: true }).click();
}
async function openAssistant(page: Page, expectedChatError = false) {
  await closeTools(page);
  const panel = page.getByTestId("aidt-assistant-panel");
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
  await openOutcome(page);
  await page.getByTestId("aidt-tools").click();
}
async function openPersonalCheckpoints(page: Page) {
  await openMaterials(page);
  const advanced = page.getByTestId("aidt-personal-checkpoints").locator("xpath=ancestor::details[1]");
  if ((await advanced.getAttribute("open")) === null) await advanced.locator(":scope > summary").click();
  const details = page.getByTestId("aidt-checkpoint-details");
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
}

test("AIDT native entity entry and explicit history tools: durable Chat, mobile, resources and access boundaries", async ({ page, browser }) => {
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
    if (width === 375) await expect(page.getByTestId("mobile-tab-aidt")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`aidt-dashboard-${width}.png`), fullPage: true });
  }
  await page.getByTestId("aidt-step-1").click();
  await expect(page.getByTestId("aidt-problem-directory")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "先新建一个问题" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-native-problem-directory.png"), fullPage: true });
  const nativeProblemName = "本次原生入口的合成问题";
  const problemCard = await createProblem(page, nativeProblemName);
  await expect(page.getByTestId("aidt-shared-status")).toContainText("小组已保存");
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(problemCard).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`aidt-problem-cards-${width}.png`), fullPage: true });
  }
  await problemCard.click();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
  const nativeProblemId = new URL(page.url()).searchParams.get("entity")!;
  const nativeProblemThread = new URL(page.url()).searchParams.get("thread")!;
  expect(nativeProblemId).toBeTruthy();
  const nativeThreadPath = `/chat/threads/${encodeURIComponent(nativeProblemThread)}`;
  const nativeThread = await api(page, `${nativeThreadPath}?projectId=${encodeURIComponent(projectId)}`);
  expect(nativeThread.status).toBe(200);
  expect(nativeThread.data.thread.id).toBe(nativeProblemThread);
  expect(nativeThread.data.thread.projectId).toBe(projectId);
  // Missing scope is the personal-thread branch, not permission to infer the owning project.
  expect((await api(page, nativeThreadPath)).status).toBe(404);
  // This other project is the visible synthetic seed fixture, not an arbitrary or real project.
  expect(projectId).not.toBe(FULLSTACK_E2E.projectId);
  expect(projectList.data.some((item: { id: string }) => item.id === FULLSTACK_E2E.projectId)).toBe(true);
  expect((await api(page, `${nativeThreadPath}?projectId=${encodeURIComponent(FULLSTACK_E2E.projectId)}`)).status).toBe(404);
  await page.screenshot({ path: test.info().outputPath("aidt-native-problem-entity-chat.png"), fullPage: true });
  await page.getByRole("link", { name: "返回问题列表" }).click();
  const renamed = "修订后的合成问题";
  await page.getByRole("button", { name: `编辑问题 ${nativeProblemName}` }).click();
  const edit = page.getByRole("dialog", { name: "编辑问题" });
  await edit.getByRole("textbox", { name: "问题名称" }).fill(renamed);
  await edit.getByRole("button", { name: "保存修改" }).click();
  const renamedCard = page.getByRole("link", { name: renamed, exact: true });
  await expect(renamedCard).toHaveAttribute("href", `/aidt/${projectId}?step=1&entity=${nativeProblemId}`);
  await page.reload();
  await renamedCard.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(nativeProblemThread);
  await page.getByRole("link", { name: "返回问题列表" }).click();
  await page.getByRole("button", { name: `删除问题 ${renamed}` }).click();
  await page.getByRole("dialog", { name: "删除问题" }).getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("heading", { name: "先新建一个问题" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "先新建一个问题" })).toBeVisible();
  // The history link is deliberately existing-only and never creates new
  // aggregate conversations. Build explicit, persisted compatibility fixtures
  // using the same native create/mount APIs exercised by the privacy checks.
  // No stage output or completion state is seeded by this setup.
  const historySkills = await api(page, `/skills?orgId=${FULLSTACK_E2E.orgId}&entry=library`);
  expect(historySkills.status).toBe(200);
  for (const [stage, stable] of [[1, "aidt-understand"], [2, "aidt-empathize"], [3, "aidt-define"], [4, "aidt-ideate"], [5, "aidt-prototype"], [6, "aidt-iterate"]] as const) {
    const skill = historySkills.data.items.find((item: { platformStableName: string }) => item.platformStableName === stable);
    expect(skill?.skillId).toBeTruthy();
    const created = await api(page, chat.operations.mutateThread.path, "POST", { op: "create", projectId, threadId: null, groupId: null, title: `[AIDT ${stage}] 历史兼容测试夹具`, visibilityScope: "plenary", expectedVersion: null, reason: null });
    expect(created.status, JSON.stringify(created.data)).toBeLessThan(300);
    const historyThread = created.data.threadId;
    const before = await api(page, `/threads/${historyThread}/skill-deviations?projectId=${projectId}`);
    expect(before.status).toBe(200);
    const mounted = await api(page, skillContracts.operations.mountSkillToThread.path.replace(":threadId", historyThread), "POST", { threadId: historyThread, skillIds: [skill.skillId], expectedVersion: before.data.version });
    expect(mounted.status, JSON.stringify(mounted.data)).toBeLessThan(300);
  }
  // Personal checkpoints and aggregate resource tools deliberately remain in
  // their visible history entry. This segment is not the six-entity student flow.
  await openHistoryTools(page);
  await expect(page.getByTestId("aidt-stage-navigation")).toHaveCount(0);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await openGuidance(page);
  await expect(page.getByTestId("aidt-input-scaffold")).toContainText("原始命题");
  await expect(page.getByText("调研市场并产出带来源的报告", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-1-start.png"), fullPage: true });
  await openOutcome(page);
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  await expect(page.getByTestId("aidt-assistant-panel")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByTestId("aidt-stage-output").getByRole("textbox")).toHaveCount(0);
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
  await openOutcome(page);
  await expect(page.getByTestId("aidt-stage-output")).toBeVisible();
  await expect(page.getByTestId("aidt-stage-output").getByRole("textbox")).toHaveCount(0);
  await openAssistant(page);
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue("尚未发送的移动端对话草稿");
  await page.getByTestId("copilotkit-v2-input").fill("");
  await openOutcome(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Reviewing a projection neither sends a message nor changes the group stage.
  await expect(page.getByTestId("aidt-stage-output")).toContainText("尚无工作坊问题草稿");
  const draftThreadId = new URL(page.url()).searchParams.get("thread")!;
  expect(draftThreadId).toBeTruthy();
  const beforeDraftSent = await api(page, `/chat/threads/${draftThreadId}/messages?limit=100`);
  expect(beforeDraftSent.data.messages).toHaveLength(0);
  await page.getByRole("link", { name: "项目总览", exact: true }).click();
  await expect(page.getByTestId("aidt-stage-save-1")).toHaveAttribute("data-completed", "false");
  await expect(page.getByTestId("aidt-materials")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-dashboard.png"), fullPage: true });
  await page.getByTestId("aidt-step-1").click();
  await openHistoryTools(page);
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
  await openOutcome(page);
  await expect(page.getByTestId("aidt-stage-output")).not.toContainText("本步对话记录");
  await expect(page.getByTestId("aidt-stage-output").getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-step-1-chat-and-problem.png"), fullPage: true });
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
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await openOutcome(page);
  await expect(page.getByTestId("aidt-stage-output").getByRole("textbox")).toHaveCount(0);
  await openPersonalCheckpoints(page);
  const restoredCheckpointDetails = page.getByTestId("aidt-checkpoint-details");
  // Resolving the authenticated thread deliberately remounts scope-bound UI.
  // Open after its server read settles, so an early click cannot hit the old scope.
  await expect(restoredCheckpointDetails.locator("summary")).toContainText("1 份服务器保存稿");
  await openPersonalCheckpoints(page);
  const checkpointSelect = page.getByTestId("aidt-checkpoint-select");
  await expect(checkpointSelect).toBeVisible();
  await checkpointSelect.selectOption(JSON.stringify([checkpointArtifactId, checkpointSource.data.immutableRevision]));
  await page.getByTestId("aidt-checkpoint-restore").click();
  await expect(page.getByTestId("aidt-checkpoint-restore-notice")).toContainText("尚未同步给小组");
  await openOutcome(page);
  await expect(page.getByTestId("aidt-stage-output")).not.toContainText("本页草稿：改善校园午餐排队");
  await closeTools(page);
  await selectHistoryStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).not.toBe(threadId);
  await openGuidance(page);
  await page.screenshot({ path: test.info().outputPath("aidt-teaching-step-2-start.png"), fullPage: true });
  await openMaterials(page);
  await expect(page.getByTestId("aidt-stage-bridge")).toContainText("工作坊主题命题");
  await page.getByTestId("aidt-stage-bridge").locator("summary").click();
  await expect(page.getByTestId("aidt-stage-bridge")).not.toContainText("本页草稿：改善校园午餐排队");
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-bridge.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("aidt-ui-v3-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await closeTools(page);
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
  const nativeMounts = await api(page, `/threads/${nativeProblemThread}/skill-deviations?projectId=${projectId}`);
  expect(nativeMounts.data.temporary).toContainEqual(expect.objectContaining({ skillId: understandSkill.skillId, removedAt: null }));
  expect(nativeProblemThread).not.toBe(threadId);
  expect(secondMounts.data.temporary).toContainEqual(expect.objectContaining({ skillId: empathySkill.skillId, removedAt: null }));
  const stageThreads = new Set([threadId, empathyThreadId]);
  for (const [number, stableName] of [[3, "aidt-define"], [4, "aidt-ideate"], [5, "aidt-prototype"], [6, "aidt-iterate"]] as const) {
    const skill = catalog.find((it: { platformStableName: string }) => it.platformStableName === stableName);
    await selectHistoryStage(page, number);
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
      await openOutcome(page);
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
      await closeTools(page);
    }

  }
  expect(stageThreads.size).toBe(6);
  await openOutcome(page);
  // Exercise the first-party sixth-step report link, including its product
  // compatibility fix; never navigate around it to manufacture a passing test.
  await page.getByRole("link", { name: "预览小组报告", exact: true }).click();
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
  // A report preview is not a conversation. Use its first-party assistant
  // entry, then the normal report directory, before checking a summary thread.
  await page.getByTestId("aidt-open-summary-chat").click();
  await expect(page.getByTestId("aidt-step-entity-directory")).toBeVisible();
  await page.getByRole("link", { name: "打开小组研究报告", exact: true }).click();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await closeTools(page);
  await expect.poll(() => {
    const query = new URL(page.url()).searchParams;
    return [query.get("step"), query.get("tool"), query.get("summary")];
  }).toEqual(["6", "chat", "1"]);
  await expect.poll(() => new URL(page.url()).searchParams.get("summaryThread")).toBeTruthy();
  expect(stageThreads.has(new URL(page.url()).searchParams.get("summaryThread")!)).toBe(false);

  await selectHistoryStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await page.reload();
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(empathyThreadId);
  await selectHistoryStage(page, 1);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("理解与提出问题");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toBe(threadId);
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible();
  await selectHistoryStage(page, 2);
  await openAssistant(page);
  await expect(page.getByTestId("aidt-step-skill")).toContainText("共情用户");
  await openStageTools(page);
  await page.getByRole("menuitem", { name: "个人录音笔记", exact: true }).click();
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
  await page.goto(`${base}step=2&tool=transcript&history=1`);
  const linkedTranscript = page.getByTestId(`project-resource-${resourceId}`);
  await expect(linkedTranscript).toBeVisible();
  await expect(linkedTranscript).toHaveText("AIDT self reflection");
  // A visible Inspector must keep native resources readable inside its actual width,
  // even on a wide desktop viewport. Viewport-based three-column grids crushed titles.
  const resourceList = page.getByTestId("project-resources-list");
  expect(await resourceList.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const titleBox = await linkedTranscript.boundingBox();
  const listBox = await resourceList.boundingBox();
  expect(await linkedTranscript.evaluate(node => ({
    horizontalClipped: node.scrollWidth > node.clientWidth,
    verticalClipped: node.scrollHeight > node.clientHeight,
  }))).toEqual({ horizontalClipped: false, verticalClipped: false });
  expect(titleBox!.x).toBeGreaterThanOrEqual(listBox!.x);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width + 1);
  await page.screenshot({ path: test.info().outputPath("aidt-native-project-resources.png"), fullPage: true });
  // Show failed reads as failures: browser transport fault, actual API data above remained real.
  await page.route(`**/projects/${projectId}/resources`, (route) => route.abort());
  await page.goto(`${base}step=5&tool=design&resource=missing&history=1`);
  await expect(page.getByTestId("aidt-resource-error")).toBeVisible();
  await page.unroute(`**/projects/${projectId}/resources`);
  // Round10: actual two-person group collaboration, with a separate browser/session.
  const memberAdded = await api(page, `/projects/${projectId}/collaborators`, "POST", { projectId, userId: FULLSTACK_E2E.memberUserId, role: "collaborator" });
  expect(memberAdded.status, JSON.stringify(memberAdded.data)).toBeLessThan(300);
  await page.goto(`/aidt/${projectId}`);
  await page.getByTestId("aidt-project-settings").click();
  const groupMembers = page.getByTestId("aidt-settings-dialog").getByTestId("aidt-group-members");
  await expect(groupMembers.getByTestId(`project-collaborator-${FULLSTACK_E2E.memberUserId}`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("aidt-group-members.png"), fullPage: true });
  await page.getByTestId("aidt-settings-dialog").getByTestId("dialog-close").click();
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "zh-CN" });
  try {
    const second = await secondContext.newPage();
    await login(second, true);
    await second.goto(`${base}step=1&history=1`);
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
    await page.goto(`${base}step=1&history=1`);
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
    await page.goto(`${base}step=1&thread=${privateId}&history=1`);
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
    await page.goto(`${base}step=1&history=1`);
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
  await page.goto(`${base}step=2&tool=record&history=1`);
  await expect(page.getByTestId("aidt-readonly")).toBeVisible();
  await expect(page.getByTestId("rec-history-page")).toHaveCount(0);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login(page, true);
  await page.goto(`${base}step=1&history=1`);
  await expect(page.getByTestId("aidt-access-denied")).toBeVisible();
  await expect(page.getByTestId("aidt-workspace")).toHaveCount(0);
});


test("AIDT first step starts in native Chat and hands a confirmed issue and reflection to interviews", async ({ page }) => {
  test.setTimeout(150_000);
  await login(page);
  await page.getByTestId("rail-aidt").click();
  await expect(page.getByRole("heading", { name: "设计思维工作坊" })).toBeVisible();
  const logo = page.getByAltText("中国传媒大学设计思维学院");
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("aidt-home.png"), fullPage: true });

  await page.getByTestId("aidt-new").click();
  await page.getByTestId("project-new-name").fill(`第一步界面验收 ${randomUUID().slice(0, 8)}`);
  await page.getByTestId("project-new-create").click();
  await expect(page).toHaveURL(/\/aidt\/[^/?]+$/);
  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByTestId("aidt-step-1").click();
  await expect(page.getByTestId("aidt-problem-directory")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveCount(0);
  const problemTitle = "校园奶茶新品";
  await (await createProblem(page, problemTitle)).click();
  await expect(page).toHaveURL(/step=1.*entity=/);
  const problemId = new URL(page.url()).searchParams.get("entity")!;
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
  const problemThread = new URL(page.url()).searchParams.get("thread")!;
  await expect(page.getByTestId("aidt-stage-navigation")).toHaveCount(0);
  await expect(logo).toHaveCount(0);
  await expect(page.getByText("你们想研究什么？")).toBeVisible();
  await page.getByRole("button", { name: "填入回答提纲" }).click();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveValue(/原始命题：/);
  await expect(page.getByText("来自对话的首条回答")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("aidt-first-answer.png"), fullPage: true });

  const initial = problemInitial;
  const confirmed = problemRevision;
  const runInChat = async (text: string) => {
    const request = await sendViaWorkbench(page, text);
    expect(AidtContextSelector.parse(request.postDataJSON().forwardedProps?.aidtContext)).toMatchObject({ projectId, stageId: 1, entityId: problemId });
    await expect.poll(async () => {
      const reply = await api(page, `/chat/threads/${problemThread}/messages?limit=100`);
      const rows: PersistedMessage[] = reply.data.messages;
      const human = rows.find(row => row.authorKind === "human" && row.text === text);
      return Boolean(human?.agentRunId && rows.some(row => row.authorKind === "agent" && row.agentRunId === human.agentRunId));
    }, { timeout: 60_000 }).toBe(true);
  };
  await runInChat("你好");
  await openOutcome(page);
  const output = page.getByTestId("aidt-stage-output");
  await expect(output).not.toContainText("你好");
  await expect(output.getByRole("textbox")).toHaveCount(0);
  await runInChat(initial);
  await expect(output).toContainText(initial, { timeout: 30_000 });
  await expect(output).toContainText("草稿");
  await runInChat(problemDiscussion);
  await expect(output).toContainText(confirmed, { timeout: 30_000 });
  await expect(output).toContainText("两位同学看菜单后离开");
  await expect(output.getByRole("button")).toHaveCount(0);
  await page.reload();
  await expect(output).toContainText(confirmed);
  await page.getByRole("tab", { name: "产物" }).click();
  await expect(output).toContainText(confirmed);
  const confirmation = page.getByTestId("aidt-round-completion").getByRole("button", { name: "确认本轮成果并保存" });
  await confirmation.click();
  const next = page.getByRole("link", { name: "继续第2步" });
  await expect(next).toBeVisible();
  const stored = await api(page, `/projects/${projectId}/aidt/stages/1`);
  expect(stored.status).toBe(200);
  const stage1Fields = stored.data.stage.content.draft.fields;
  expect(stage1Fields.problemHandoffEntity).toBe(problemId);
  expect(JSON.parse(stage1Fields["problemDraft:" + problemId])).toMatchObject({
    initial, rewrittenTheme: confirmed, problemReflectionConfirmed: "true",
    sourceUncertainty: "离开的原因仍待核实",
  });
  await page.screenshot({ path: test.info().outputPath("aidt-first-confirmed.png"), fullPage: true });

  await next.click();
  await expect(page).toHaveURL(/step=2/);
  const directory = new URL(page.url()).searchParams;
  expect(directory.get("problemEntity")).toBe(problemId);
  expect(directory.get("problemRevision")).toBe(String(stored.data.stage.revision));
  await expect(page.getByTestId("aidt-step-entity-directory")).toBeVisible();
  await expect(page.getByTestId("copilotkit-v2-input")).toHaveCount(0);
  await page.getByTestId("aidt-new-entity-card").click();
  await page.getByTestId("aidt-shared-save").click();
  await expect(page.getByTestId("aidt-shared-receipt")).toBeVisible();
  const storedInterview = await api(page, `/projects/${projectId}/aidt/stages/2`);
  expect(storedInterview.status).toBe(200);
  const interviewFields: Record<string, string> = storedInterview.data.stage.content.draft.fields;
  const records = Object.entries(interviewFields).filter(([key]) => key.startsWith("interviewRecord:"));
  expect(records).toHaveLength(1);
  const [key, content] = records[0]!;
  const interviewId = key.slice("interviewRecord:".length);
  expect(JSON.parse(content)).toMatchObject({
    id: interviewId, problemEntityId: problemId, topicRevision: stored.data.stage.revision, topic: confirmed,
  });
  await page.getByRole("button", { name: /U01/ }).click();
  await expect(page).toHaveURL(/step=2.*entity=/);
  await expect.poll(() => new URL(page.url()).searchParams.get("thread")).toMatch(/^thr_aidt_/);
  expect(new URL(page.url()).searchParams.get("thread")).not.toBe(problemThread);
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  const interview = await sendViaWorkbench(page, "我先拟一道访谈问题：请回想最近一次你看见新品菜单时发生了什么。");
  const context = AidtContextSelector.parse(interview.postDataJSON().forwardedProps?.aidtContext);
  await page.screenshot({ path: test.info().outputPath("aidt-interview-handoff.png"), fullPage: true });
  expect(context).toMatchObject({ projectId, stageId: 2, entityId: interviewId, sourceEntityId: problemId, stageRevisions: [{ stageId: 1, revision: stored.data.stage.revision }, { stageId: 2, revision: 1 }] });
  await page.getByRole("link", { name: "返回访谈列表" }).click();
  await expect(page.getByTestId("aidt-step-entity-directory")).toBeVisible();
  const back = new URL(page.url()).searchParams;
  expect(back.get("problemEntity")).toBe(problemId);
  expect(back.get("problemRevision")).toBe(String(stored.data.stage.revision));
  expect(back.has("entity")).toBe(false);
});
