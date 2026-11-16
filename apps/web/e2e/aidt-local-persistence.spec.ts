import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, isAbsolute } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import { LOCAL_ADMIN_EMAIL, resolveLocalConfig, webEnv } from "../../../packages/local-runtime/src/config";
import { acquireWebOutputLease, checkAidtWebBuild } from "../../../packages/local-runtime/src/aidt-web-build";
import { operations, SharedStage } from "@repo/contracts/aidt-stages";
import * as memberChat from "@repo/contracts/project-member-chat";
import type { z } from "zod";
import { acceptAidtMemberText } from "./support/aidt-member-text-acceptance";
import { acceptAidtMemberMultiuser } from "./support/aidt-member-multiuser-acceptance";

const repo = resolve(process.cwd(), "../..");
const dataDir = process.env.AIDT_LOCAL_DATA_DIR!;
const webMode = process.env.AIDT_LOCAL_WEB_MODE ?? "dev";
const reuseBuild = process.env.AIDT_LOCAL_REUSE_BUILD === "1";
const trimBuildCache = process.env.AIDT_LOCAL_TRIM_BUILD_CACHE === "1";
// This test-only override does not change production build inputs or its receipt.
test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });
const ports = {
  postgres: Number(process.env.PGPORT), api: Number(process.env.WORKSPACEX_API_PORT),
  web: Number(process.env.WORKSPACEX_WEB_PORT), sandbox: Number(process.env.SKILL_SANDBOX_PORT),
  deepAgent: Number(process.env.WORKSPACEX_DEEP_AGENT_PROVIDER_PORT), ollama: Number(process.env.WORKSPACEX_MODEL_PROVIDER_PORT),
  asr: Number(process.env.WORKSPACEX_ASR_PROVIDER_PORT),
};
const args = ["--data-dir", dataDir, "--repo-root", repo, "--ports", Object.entries(ports).map(([k, v]) => `${k}=${v}`).join(",")];
const origin = `http://127.0.0.1:${ports.api}`;
const leasePorts = [...Object.values(ports), ...["REDIS_PORT", "MINIO_PORT", "MINIO_CONSOLE_PORT", "WORKSPACEX_VISION_PROVIDER_PORT", "WORKSPACEX_LOOPBACK_SANDBOX_PORT", "WORKSPACEX_MAIL_PROVIDER_PORT"].map(key => Number(process.env[key]))];
type Health = { state: string; details?: { healthy?: boolean; phase?: string; webMode?: string; checkedAt?: string; capabilities?: { id: string; available: boolean }[] } };
function cli(command: string, timeoutMs = 25_000, log?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("pnpm", ["aidt:local", command, ...args], { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Local ${command} command timed out`)); }, timeoutMs);
    child.stdout.on("data", b => { stdout += String(b); if (log) appendFileSync(log, b); });
    child.stderr.on("data", b => { stderr += String(b); if (log) appendFileSync(log, b); });
    child.once("error", e => { clearTimeout(timer); reject(e); });
    child.once("exit", code => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr }); });
  });
}
function report(stdout: string): Health { return JSON.parse(stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)) as Health; }
async function free(port: number): Promise<boolean> {
  return new Promise(done => { const server = createServer(); server.once("error", () => done(false)); server.listen(port, "127.0.0.1", () => server.close(() => done(true))); });
}
function pgdataDigest(root: string): string | null {
  if (!existsSync(root)) return null;
  const hash = createHash("sha256");
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hash.update(path.slice(root.length)).update(readFileSync(path));
      else throw new Error("Unexpected link in owned acceptance pgdata");
    }
  }
  visit(root);
  return hash.digest("hex");
}
async function login(page: Page) {
  const secret = JSON.parse(readFileSync(join(dataDir, "secrets.json"), "utf8")) as { adminPassword: string };
  await page.goto("/login");
  await page.getByTestId("login-email").fill(LOCAL_ADMIN_EMAIL);
  await page.getByTestId("login-password").fill(secret.adminPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
}
async function api(page: Page, path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  return page.evaluate(async ({ origin, path, method, body }) => {
    const r = await fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer ${localStorage.getItem("wsx.sessionToken")}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }, { origin, path, method, body });
}
type NativeStage = z.infer<typeof SharedStage>;
function phase(name: string) { console.info(`[aidt-native] ${new Date().toISOString()} ${name}`); }
function historicalResponse(page: Page, projectId: string, revision: number) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && response.request().method() === "GET"
      && url.pathname === `/projects/${projectId}/aidt/stages/6/revisions`
      && url.searchParams.get("beforeRevision") === String(revision + 1)
      && url.searchParams.get("limit") === "1";
  });
}
async function readHistoricalReturn(page: Page, projectId: string, round: NativeStage, latest: NativeStage) {
  expect(round.revision).toBeLessThan(latest.revision);
  const step = Number(round.content.draft.fields.returnStep);
  expect(Number.isInteger(step) && step >= 1 && step <= 5).toBe(true);
  const response = historicalResponse(page, projectId, round.revision);
  await page.goto(`/aidt/${projectId}?step=${step}&tool=outcome&returnRevision=${round.revision}`);
  const received = await response;
  expect(received.status()).toBe(200);
  expect(operations.history.out.parse(await received.json()).items).toEqual([round]);
  const context = page.getByTestId("aidt-return-context");
  await expect(context).toContainText(`第6步共享 V${round.revision}`);
  await expect(context).toContainText(round.content.draft.fields.returnReason!);
  await expect(context).toContainText(round.content.draft.fields.nextAction!);
  await expect(page.getByTestId("aidt-return-unavailable")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(String(round.revision));
  // The same real historical read must reach the existing native Chat host.
  // This proves the mounted projection, without claiming a model consumed it.
  await page.getByRole("link", { name: "返回本步对话", exact: true }).click();
  const isSelectedChat = (url: URL) => url.pathname === `/aidt/${projectId}` && url.searchParams.get("step") === String(step)
    && url.searchParams.get("tool") === "chat" && url.searchParams.get("returnRevision") === String(round.revision);
  // A Link click can finish before the App Router commits its navigation.
  // Reload only after Chat is visible, or the old outcome route is reloaded.
  await expect(page).toHaveURL(isSelectedChat);
  await expect(page.getByTestId("aidt-assistant-panel")).toBeVisible();
  // Reload the visible Chat route so this response belongs to its own loader,
  // rather than the outcome panel's earlier historical read.
  const chatRead = historicalResponse(page, projectId, round.revision);
  await page.reload();
  await expect(page).toHaveURL(isSelectedChat);
  const chatReceived = await chatRead;
  expect(chatReceived.status()).toBe(200);
  expect(operations.history.out.parse(await chatReceived.json()).items).toEqual([round]);
  const chatContext = page.getByTestId("aidt-chat-return-context");
  await expect(chatContext).toBeVisible();
  await expect(chatContext.locator("summary")).toContainText(`第6步 V${round.revision}`);
  await chatContext.locator("summary").click();
  const preview = page.getByLabel("AI参考的历史返工反思", { exact: true });
  await expect(preview).toBeVisible();
  const projected = JSON.parse(await preview.innerText()) as Record<string, string>;
  expect(projected).toMatchObject({ returnReason: round.content.draft.fields.returnReason, nextAction: round.content.draft.fields.nextAction, originalQuestion: JSON.parse(round.content.draft.fields.questionSnapshot!).question });
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(String(round.revision));
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-return-context")).toContainText(round.content.draft.fields.returnReason!);
  expect(SharedStage.parse((await api(page, `/projects/${projectId}/aidt/stages/6`)).data.stage)).toEqual(latest);
  phase(`historical-return-${step}-reads-V${round.revision}-not-head-V${latest.revision}`);
}
async function rejectedReturnKeepsChat(page: Page, projectId: string, revision: number) {
  await page.getByRole("link", { name: "返回本步对话", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/aidt/${projectId}` && url.searchParams.get("tool") === "chat"
    && url.searchParams.get("returnRevision") === String(revision));
  const context = page.getByTestId("aidt-chat-return-context");
  await expect(context).toBeVisible();
  await expect(context.locator("summary")).toContainText("尚未带入AI");
  await context.locator("summary").click();
  await expect(page.getByLabel("AI参考的历史返工反思", { exact: true })).toHaveCount(0);
  const retried = historicalResponse(page, projectId, revision);
  await page.getByRole("button", { name: "重新读取返工反思", exact: true }).click();
  expect((await retried).status()).toBe(200);
  await expect(context.locator("summary")).toContainText("尚未带入AI");
  const composer = page.getByTestId("copilotkit-v2-input");
  await expect(composer).toBeVisible();
  await composer.fill("合成验收草稿：上下文缺失时仍可自行讨论；不发送模型请求。");
  await expect(composer).toHaveValue(/上下文缺失/);
  await composer.fill("");
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-return-unavailable")).toBeVisible();
}
async function openOutcome(page: Page, projectId: string, stage: number) {
  phase(`opening-stage-${stage}`);
  await page.goto(`/aidt/${projectId}?step=${stage}&tool=outcome`);
  await expect(page.getByTestId("aidt-stage-fields")).toHaveAttribute("data-stage", String(stage));
  await expect(page.getByTestId("aidt-shared-status")).not.toContainText("正在读取");
  await expect(page.getByTestId("aidt-shared-load-error")).toHaveCount(0);
  phase(`stage-${stage}-ready`);
}
async function saveNativeStage(page: Page, projectId: string, stage: number): Promise<NativeStage> {
  const path = `/projects/${projectId}/aidt/stages/${stage}`;
  const response = page.waitForResponse(r => r.request().method() === "PUT" && new URL(r.url()).pathname === path);
  await expect(page.getByTestId("aidt-shared-save")).toBeEnabled();
  await page.getByTestId("aidt-shared-save").click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  const value = SharedStage.parse((await saved.json()).stage);
  await expect(page.getByTestId("aidt-shared-receipt")).toContainText(`V${value.revision}`);
  expect(SharedStage.parse((await api(page, path)).data.stage)).toEqual(value);
  phase(`stage-${stage}-saved-V${value.revision}`);
  return value;
}
async function appendNativeReportHistory(page: Page, projectId: string, priorHead: NativeStage, branches: NativeStage[]) {
  const report = page.getByLabel("小组报告草稿", { exact: true });
  await expect(report).toHaveValue(priorHead.content.summaryReport!.markdown);
  const manualMarker = `学生人工审阅说明 ${randomUUID()}：历史记录是学习过程，材料真实性仍需核对。`;
  const before = `${await report.inputValue()}\n\n${manualMarker}`;
  await report.fill(before);
  await expect(report).toHaveValue(before);
  const history = page.getByTestId("aidt-report-history");
  await history.locator("summary").click();
  const mutations: string[] = [];
  const watchMutation = (request: Request) => {
    if (["PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith(`/projects/${projectId}/aidt/stages`)) mutations.push(request.url());
  };
  page.on("request", watchMutation);
  let chapter: string;
  let reportText: string;
  let readRevisions: number[];
  try {
    // The real service reads limit+1 rows: nextBeforeRevision is the last
    // returned revision only when more rows exist. Register both pages before
    // starting the collector so its sequential reads cannot race the observer.
    const firstPageResponses = [1, 2, 3, 4, 5, 6].map(stage => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && response.request().method() === "GET"
        && url.pathname === `/projects/${projectId}/aidt/stages/${stage}/revisions`
        && url.searchParams.get("limit") === "5" && !url.searchParams.has("beforeRevision");
    }));
    const secondPageResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && response.request().method() === "GET"
        && url.pathname === `/projects/${projectId}/aidt/stages/6/revisions`
        && url.searchParams.get("limit") === "5" && url.searchParams.has("beforeRevision");
    });
    await page.getByRole("button", { name: "读取历史学习记录", exact: true }).click();
    const [firstResponses, secondResponse] = await Promise.all([Promise.all(firstPageResponses), secondPageResponse]);
    const firstPages = await Promise.all(firstResponses.map(async response => {
      expect(response.status()).toBe(200);
      return operations.history.out.parse(await response.json());
    }));
    const firstLearning = firstPages[5]!;
    expect(firstLearning.items).toHaveLength(5);
    expect(firstLearning.nextBeforeRevision).toBe(firstLearning.items.at(-1)!.revision);
    expect(new URL(secondResponse.url()).searchParams.get("beforeRevision")).toBe(String(firstLearning.nextBeforeRevision));
    expect(secondResponse.status()).toBe(200);
    const secondLearning = operations.history.out.parse(await secondResponse.json());
    expect(secondLearning.nextBeforeRevision).toBeNull();
    const actualLearning = [...firstLearning.items, ...secondLearning.items];
    expect(actualLearning).toEqual([...branches, priorHead].sort((a, b) => b.revision - a.revision));
    readRevisions = actualLearning.map(round => round.revision);
    // No S2 research was submitted in this synthetic journey; the collector
    // must retain that actual server gap rather than inventing research.
    expect(firstPages[1]!.items).toEqual([]);
    expect(firstPages[1]!.nextBeforeRevision).toBeNull();
    const preview = page.getByTestId("aidt-report-history-chapter");
    await expect(preview).toBeVisible();
    for (const stage of [1, 2, 3, 4, 5, 6]) await expect(preview).toContainText(`第${stage}步历史`);
    for (const round of [branches[0]!, priorHead]) {
      await expect(preview).toContainText(`第6步 V${round.revision}`);
      await expect(preview).toContainText(round.content.draft.fields.returnReason!);
    }
    for (const text of ["历史学习追溯 · 服务器保存记录", "暂未决定，待支持", "没有服务器保存记录，材料缺失", "保存修订并非独立学习轮次"]) await expect(preview).toContainText(text);
    for (const text of ["读取失败或超时", "时间预算已用完", "达到读取上限，历史已截断"]) await expect(preview).not.toContainText(text);
    chapter = await preview.innerText();
    await expect(report).toHaveValue(before);
    const review = page.getByRole("checkbox", { name: "我已审阅来源版本、学习决定与缺失项", exact: true });
    const append = page.getByRole("button", { name: "追加历史章节到当前报告", exact: true });
    await expect(review).not.toBeChecked();
    await expect(append).toBeDisabled();
    expect(mutations).toEqual([]);
    await review.check();
    await expect(append).toBeEnabled();
    await append.click();
    reportText = `${before}\n\n${chapter}\n`;
    await expect(report).toHaveValue(reportText);
    await expect(page.getByTestId("aidt-report-history-chapter")).toHaveCount(0);
    expect(mutations).toEqual([]);
    const unchanged = await api(page, `/projects/${projectId}/aidt/stages/6`);
    expect(unchanged.status).toBe(200);
    expect(SharedStage.parse(unchanged.data.stage)).toEqual(priorHead);
  } finally { page.off("request", watchMutation); }
  const response = page.waitForResponse(value => value.request().method() === "PUT" && new URL(value.url()).pathname === `/projects/${projectId}/aidt/stages/6`);
  await expect(page.getByTestId("aidt-report-save")).toBeEnabled();
  await page.getByTestId("aidt-report-save").click();
  const received = await response;
  expect(received.status()).toBe(200);
  const stage = SharedStage.parse((await received.json()).stage);
  expect(stage.revision).toBe(priorHead.revision + 1);
  expect(stage.content.draft).toEqual(priorHead.content.draft);
  expect(stage.content.summaryReport!.markdown).toBe(reportText);
  expect(stage.content.summaryReport!.sourceStageRevisions).toEqual(priorHead.content.summaryReport!.sourceStageRevisions);
  await expect(page.getByTestId("aidt-report-save-state")).toContainText("小组报告已保存");
  await expect(page.getByTestId("aidt-report-receipt").locator("summary")).toContainText(`V${stage.revision}`);
  const current = await api(page, `/projects/${projectId}/aidt/stages/6`);
  expect(current.status).toBe(200);
  expect(SharedStage.parse(current.data.stage)).toEqual(stage);
  const priorReport = await api(page, `/projects/${projectId}/aidt/stages/6/revisions?beforeRevision=${priorHead.revision + 1}&limit=1`);
  expect(priorReport.status).toBe(200);
  expect(operations.history.out.parse(priorReport.data).items).toEqual([priorHead]);
  phase(`report-history-reviewed-and-saved-V${stage.revision}-preserves-prior-V${priorHead.revision}`);
  return { stage, chapter, reportText, manualMarker, readRevisions, previousReportRevision: priorHead.revision, historyReadAutomaticallySaved: false };
}
async function nativeV2Journey(page: Page, projectId: string) {
  const saved: Record<number, NativeStage> = {}, branches: NativeStage[] = [];
  await openOutcome(page, projectId, 3);
  await page.getByRole("radio", { name: "暂无意外发现", exact: true }).check();
  await page.getByTestId("aidt-surprise-confirm").click();
  saved[3] = await saveNativeStage(page, projectId, 3);
  expect(saved[3].content.draft.fields).toMatchObject({ surpriseStatus: "none", surpriseConfirmed: "true" });
  expect(saved[3].content.draft.fields.personaBehavior ?? "").toBe("");

  await openOutcome(page, projectId, 4);
  const titles = ["验收示例：纸面取餐提示", "验收示例：同伴口头指路", "验收示例：号码牌分区"];
  for (let i = 0; i < titles.length; i++) {
    await page.getByLabel(`候选${i + 1}名称`, { exact: true }).fill(titles[i]!);
    await page.getByLabel(`候选${i + 1}核心说明`, { exact: true }).fill("自动化验收的学生点子输入，仅用于验证分类和保存。不是实地研究结论。");
  }
  await page.getByRole("radio", { name: "拟选择候选 2（不是投票）", exact: true }).check();
  await page.getByRole("checkbox", { name: `${titles[0]} · 最容易实现的`, exact: true }).check();
  await page.getByRole("checkbox", { name: `${titles[0]} · 最有趣的`, exact: true }).check();
  await page.getByLabel(`${titles[0]} · 分类理由`, { exact: true }).fill("学生示例判断：纸面可先尝试，也可能有趣；仍需真实测试。");
  await page.getByRole("button", { name: "确认本组分类", exact: true }).click();
  await page.getByLabel(`${titles[0]} · 分类理由`, { exact: true }).fill("学生修改后的分类判断：先尝试纸面；有趣只是小组看法，仍需测试。");
  await expect(page.getByTestId("aidt-classification-status")).toHaveText("待学生确认分类");
  await expect(page.getByRole("radio", { name: "拟选择候选 2（不是投票）", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "确认本组分类", exact: true }).click();
  saved[4] = await saveNativeStage(page, projectId, 4);
  const ideas = saved[4].content.draft.ideas;
  expect(saved[4].content.draft.selectedIdeaId).toBe(ideas[1]!.id);
  expect(JSON.parse(saved[4].content.draft.fields.ideaClassificationTags!)).toMatchObject({ [ideas[0]!.id]: ["easy", "fun"] });
  expect(saved[4].content.draft.fields.ideaClassificationConfirmed).toBe("true");

  await openOutcome(page, projectId, 5);
  await expect(page.getByRole("button", { name: "打开原生 Design Workbench", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true }).fill("验收示例：学生能否看懂纸面取餐分区提示？");
  await page.getByTestId("aidt-verification-question").locator("summary").click();
  await page.getByRole("textbox", { name: "测试前，你们怎么想？", exact: true }).fill("仅为学生猜测：可能看懂；尚未开展真实用户测试。");
  await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).fill("自动化验收合成的表单输入，无实地证据，不是已证实结论。");
  await page.getByRole("textbox", { name: "这个原型能了解什么，还有什么不能验证？", exact: true }).fill("纸面示意只能讨论理解，不能证明真实排队时间改善。");
  await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  await expect(page.getByRole("link", { name: "打开原生 Design Workbench", exact: true })).toBeVisible();
  console.info(JSON.stringify({ phase: "s5-populated-label-diagnostic", exactLabelCount: await page.getByLabel("目前看法的依据", { exact: true }).count(), textboxRoleCount: await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).count() }));
  await page.getByRole("textbox", { name: "目前看法的依据", exact: true }).fill("修改后的学生猜测说明，仍无实地证据。");
  await expect(page.getByRole("button", { name: "打开原生 Design Workbench", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  await page.getByTestId("aidt-more-fields").locator("summary").click();
  await page.getByTestId("aidt-field-version").fill("自动化验收：学生纸面原型引用P1；非系统生成文件，真实性未核验。");
  saved[5] = await saveNativeStage(page, projectId, 5);
  expect(saved[5].content.draft.fields.verificationQuestionConfirmed).toBe("true");

  await openOutcome(page, projectId, 6);
  await page.getByRole("button", { name: "带入本轮验证问题", exact: true }).click();
  const reflection = page.getByTestId("aidt-test-reflection");
  await reflection.getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true }).selectOption("unchanged");
  await reflection.getByRole("textbox", { name: "测试后的认识", exact: true }).fill("尚未改变原先猜测；这只是验收表单分支，不代表实际测试完成。");
  await reflection.getByRole("textbox", { name: "支持判断的测试材料", exact: true }).fill("无真实测试材料：自动化验收仅验证学生输入与服务器回读。");
  await reflection.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption("1");
  await reflection.getByRole("textbox", { name: "为什么从这里重新入手？", exact: true }).fill("先重新界定研究范围，不需要为保存学习记录生成新版。");
  await reflection.getByRole("textbox", { name: "下一步具体做什么？", exact: true }).fill("重新讨论具体人群和场景，之后开展真实研究。");
  await reflection.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
  branches.push(await saveNativeStage(page, projectId, 6));
  const originalSnapshot = branches[0]!.content.draft.fields.questionSnapshot!;
  expect(JSON.parse(originalSnapshot)).toMatchObject({ question: saved[5].content.draft.fields.verificationQuestion, sourceStageRevision: saved[5].revision });
  expect(branches[0]!.sourceStageRevisions).toContainEqual({ stageId: 5, revision: saved[5].revision });
  expect(branches[0]!.content.draft.fields.newVersion ?? "").toBe("");
  await page.getByTestId("aidt-round-navigation").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/aidt/${projectId}\\?step=1&tool=outcome&returnRevision=`));
  await expect(page.getByTestId("aidt-return-context")).toContainText("重新界定研究范围");
  // Resolve the real native thread before checking the link. Previously its
  // history.replaceState erased the saved reflection reference after loading.
  await expect.poll(() => new URL(page.url()).searchParams.get("thread"), { timeout: 60_000 }).toBeTruthy();
  const roundRevision = String(branches[0]!.revision);
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(roundRevision);
  const returnedThread = new URL(page.url()).searchParams.get("thread");
  await page.getByRole("link", { name: "阶段交接", exact: true }).click();
  await expect(page.getByTestId("aidt-materials")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(roundRevision);
  await page.getByRole("link", { name: "关闭工具，回到对话", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tool=chat(?:&|$)/);
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(roundRevision);
  expect(new URL(page.url()).searchParams.get("thread")).toBe(returnedThread);
  await page.getByTestId("aidt-open-output").click();
  await expect(page.getByTestId("aidt-return-context")).toContainText("重新界定研究范围");
  await page.reload();
  await expect(page.getByTestId("aidt-return-context")).toContainText("重新界定研究范围");
  await expect.poll(() => new URL(page.url()).searchParams.get("thread"), { timeout: 60_000 }).toBe(returnedThread);
  expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(roundRevision);
  phase("learning-round-survives-native-chat-tools-and-refresh");

  await openOutcome(page, projectId, 5);
  await page.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true }).fill("修改后的下一轮问题：学生从哪里开始寻找取餐区？");
  await page.getByRole("button", { name: "确认本轮验证问题", exact: true }).click();
  saved[5] = await saveNativeStage(page, projectId, 5);
  await openOutcome(page, projectId, 6);
  await expect(page.getByTestId("aidt-bound-question")).toContainText("学生能否看懂纸面取餐分区提示");
  await reflection.getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true }).selectOption("insufficient");
  await reflection.getByRole("textbox", { name: "测试后的认识", exact: true }).fill("");
  await reflection.getByRole("textbox", { name: "支持判断的测试材料", exact: true }).fill("");
  await reflection.getByRole("textbox", { name: "仍不确定的地方", exact: true }).fill("没有真实测试，需补充理解过程及观察材料。");
  await reflection.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption("undecided");
  await reflection.getByRole("textbox", { name: "需要什么支持才能继续？", exact: true }).fill("希望教师帮助判断先访谈还是先改题；系统没有自动通知教师。");
  await reflection.getByRole("textbox", { name: "下一步具体做什么？（可稍后补充）", exact: true }).fill("");
  await reflection.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
  branches.push(await saveNativeStage(page, projectId, 6));
  await expect(page.getByTestId("aidt-round-navigation")).toHaveCount(0);
  for (const step of [3, 4, 5]) {
    await reflection.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption(String(step));
    await reflection.getByRole("textbox", { name: "为什么从这里重新入手？", exact: true }).fill(`学生选择返回第${step}步：补充本步讨论，证据仍不足。`);
    await reflection.getByRole("textbox", { name: "下一步具体做什么？", exact: true }).fill(`先由学生审阅第${step}步已有成果，再决定是否修订；不自动生成新版。`);
    await reflection.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
    const round = await saveNativeStage(page, projectId, 6);
    branches.push(round);
    expect(round.content.draft.fields.questionSnapshot).toBe(originalSnapshot);
    expect(round.content.draft.fields.newVersion ?? "").toBe("");
    await page.getByTestId("aidt-round-navigation").getByRole("link").click();
    await expect(page.getByTestId("aidt-return-context")).toContainText(round.content.draft.fields.returnReason!);
    expect(new URL(page.url()).searchParams.get("step")).toBe(String(step));
    expect(new URL(page.url()).searchParams.get("returnRevision")).toBe(String(round.revision));
    await openOutcome(page, projectId, 6);
  }
  await reflection.getByRole("combobox", { name: "如果继续改进，优先从哪一步重新入手？", exact: true }).selectOption("2");
  await reflection.getByRole("textbox", { name: "为什么从这里重新入手？", exact: true }).fill("缺少真实证据，先回访谈；不是测试通过。");
  await reflection.getByRole("textbox", { name: "下一步具体做什么？", exact: true }).fill("拟定真实访谈问题并取得适当授权。");
  await reflection.getByRole("button", { name: "确认本轮学习记录", exact: true }).click();
  saved[6] = await saveNativeStage(page, projectId, 6);
  branches.push(saved[6]);
  expect(saved[6].content.draft.fields.questionSnapshot).toBe(originalSnapshot);
  expect(saved[6].sourceStageRevisions).toContainEqual({ stageId: 5, revision: JSON.parse(originalSnapshot).sourceStageRevision });
  expect(saved[6].content.draft.fields.newVersion ?? "").toBe("");
  await page.getByTestId("aidt-round-navigation").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/aidt/${projectId}\\?step=2&tool=outcome&returnRevision=`));
  await expect(page.getByTestId("aidt-return-context")).toContainText("缺少真实证据");
  await page.goto(`/aidt/${projectId}?step=6&tool=report`);
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  await page.getByRole("button", { name: "从成果重新整理", exact: true }).click();
  const reportDraft = page.getByLabel("小组报告草稿", { exact: true });
  await expect(reportDraft).toHaveValue(/拟定真实访谈问题/);
  const reportText = await reportDraft.inputValue();
  for (const value of ["暂无", "最容易实现", "纸面取餐分区提示", "证据不足", "拟定真实访谈问题"]) expect(reportText).toContain(value);
  const reportResponse = page.waitForResponse(r => r.request().method() === "PUT" && new URL(r.url()).pathname === `/projects/${projectId}/aidt/stages/6`);
  await page.getByTestId("aidt-report-save").click();
  const reportSaved = await reportResponse;
  expect(reportSaved.status()).toBe(200);
  const latest = SharedStage.parse((await reportSaved.json()).stage);
  expect(latest.content.draft).toEqual(saved[6].content.draft);
  expect(latest.content.summaryReport?.markdown).toBe(reportText);
  saved[6] = latest;
  const history = await api(page, `/projects/${projectId}/aidt/stages/6/revisions`);
  expect(history.status).toBe(200);
  for (const branch of branches) expect(SharedStage.parse(history.data.items.find((item: NativeStage) => item.revision === branch.revision))).toEqual(branch);
  const returnRounds = branches.filter(branch => /^[1-5]$/.test(branch.content.draft.fields.returnStep ?? ""));
  expect(new Set(returnRounds.map(round => round.content.draft.fields.returnStep))).toEqual(new Set(["1", "2", "3", "4", "5"]));
  const mutations: string[] = [];
  const watchMutation = (request: Request) => {
    if (["PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.startsWith(`/projects/${projectId}/aidt/stages`)) mutations.push(request.url());
  };
  page.on("request", watchMutation);
  try {
    for (const round of returnRounds) await readHistoricalReturn(page, projectId, round, latest);
    const oldRound = returnRounds[0]!;
    // A valid saved revision is insufficient when its chosen destination differs.
    const wrongTargetResponse = historicalResponse(page, projectId, oldRound.revision);
    await page.goto(`/aidt/${projectId}?step=2&tool=outcome&returnRevision=${oldRound.revision}`);
    expect((await wrongTargetResponse).status()).toBe(200);
    await expect(page.getByTestId("aidt-return-unavailable")).toBeVisible();
    await expect(page.getByTestId("aidt-return-context")).toHaveCount(0);
    await rejectedReturnKeepsChat(page, projectId, oldRound.revision);
    // The real endpoint returns a different, existing head for a missing future
    // revision. The UI must reject it, including on an actual read retry.
    const missingRevision = latest.revision + 1;
    const missingResponse = historicalResponse(page, projectId, missingRevision);
    await page.goto(`/aidt/${projectId}?step=1&tool=outcome&returnRevision=${missingRevision}`);
    const missing = await missingResponse;
    expect(missing.status()).toBe(200);
    expect(operations.history.out.parse(await missing.json()).items).toEqual([latest]);
    await expect(page.getByTestId("aidt-return-unavailable")).toBeVisible();
    await expect(page.getByTestId("aidt-return-context")).toHaveCount(0);
    const retried = historicalResponse(page, projectId, missingRevision);
    await page.getByRole("button", { name: "重试读取本轮学习", exact: true }).click();
    expect((await retried).status()).toBe(200);
    await expect(page.getByTestId("aidt-return-unavailable")).toBeVisible();
    await expect(page.getByTestId("aidt-return-context")).toHaveCount(0);
    await rejectedReturnKeepsChat(page, projectId, missingRevision);
    await readHistoricalReturn(page, projectId, oldRound, latest);
    expect(mutations).toEqual([]);
    expect(SharedStage.parse((await api(page, `/projects/${projectId}/aidt/stages/5`)).data.stage)).toEqual(saved[5]);
  } finally { page.off("request", watchMutation); }
  // Preserve the original member-plugin entry from the saved report workspace.
  await page.goto(`/aidt/${projectId}?step=6&tool=report`);
  await expect(page.getByTestId("aidt-report-reload")).toBeEnabled();
  const historyReport = await appendNativeReportHistory(page, projectId, latest, branches);
  saved[6] = historyReport.stage;
  return { saved, branches, returnRounds, historyReport, historicalReadsDoNotSave: true, prototypeInputIsStudentText: true, actualGeneratedPrototype: false, actualResearchCollected: false };
}

test("native local start/save/stop/restart preserves AIDT and human text without Docker or a model fixture", async ({ page, browser }) => {
  const output = process.env.AIDT_LOCAL_OUTPUT_DIR ?? test.info().outputDir;
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  expect(isAbsolute(dataDir)).toBe(true);
  for (const port of Object.values(ports)) expect(Number.isInteger(port) && port > 0).toBe(true);
  mkdirSync(output, { recursive: true });
  const evidence: Record<string, unknown> = { isolationId: process.env.WORKSPACEX_ISOLATION_ID, dataDir, ports, leasePorts, webMode, reusedBuild: reuseBuild, parentNodeEnv: process.env.NODE_ENV ?? null, supplierFixture: false, docker: false };
  let owner: ChildProcess | undefined;
  let ownerExit: Promise<number> | undefined;
  let ownerCode: number | null = null;
  let buildOwnerInstance: string | null = null;
  let privateTraceStarted = false;
  function ownerInstance(): string | null {
    try {
      const value = JSON.parse(readFileSync(join(dataDir, "run", "aidt-owner.json"), "utf8")) as { instanceId?: unknown };
      return typeof value.instanceId === "string" ? value.instanceId : null;
    } catch { return null; }
  }
  async function start(cycle: number) {
    phase(`native-start-${cycle}`);
    expect(existsSync(join(dataDir, "run", "aidt-owner.json"))).toBe(false);
    ownerCode = null;
    const started = Date.now();
    const log = join(output, `native-start-${cycle}.log`);
    owner = spawn("pnpm", ["aidt:local", "start", ...args, "--web", webMode], { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    owner.stdout!.on("data", b => appendFileSync(log, b)); owner.stderr!.on("data", b => appendFileSync(log, b));
    ownerExit = new Promise(done => owner!.once("exit", code => { ownerCode = code ?? 1; done(ownerCode); }));
    await expect.poll(async () => {
      if (ownerCode !== null) throw new Error(`Native start ${cycle} exited ${ownerCode}; inspect its private local log`);
      const result = await cli("health");
      if (result.code !== 0) return false;
      const health = report(result.stdout);
      if (health.details?.healthy) {
        expect(health.details.webMode).toBe(webMode);
        evidence[`nativeCycle${cycle}ReadyMs`] = Date.now() - started;
        writeFileSync(join(output, `health-${cycle}.json`), JSON.stringify(health, null, 2));
        return true;
      }
      return false;
    }, { timeout: 360_000, intervals: [1000, 2000, 3000] }).toBe(true);
    const first = report((await cli("health")).stdout), second = report((await cli("health")).stdout);
    expect(second.details?.checkedAt).not.toBe(first.details?.checkedAt);
    expect(second.details?.capabilities?.find(c => c.id === "chat-model")?.available).toBe(false);
    phase(`native-start-${cycle}-healthy`);
    return second;
  }
  async function stop(cycle: number) {
    phase(`native-stop-${cycle}`);
    const result = await cli("stop", 150_000);
    expect(result.code).toBe(0);
    expect(await ownerExit).toBe(0);
    const status = report((await cli("status")).stdout);
    expect(status.state).toBe("stopped");
    expect((await cli("health")).code).toBe(1);
    const released = await Promise.all(Object.values(ports).map(async port => ({ port, free: await free(port) })));
    expect(released.every(p => p.free)).toBe(true);
    expect(existsSync(join(dataDir, "pgdata"))).toBe(true);
    writeFileSync(join(output, `stopped-${cycle}.json`), JSON.stringify({ status, ports: released, savedDataRetained: true }, null, 2));
    owner = undefined; ownerExit = undefined;
    phase(`native-stop-${cycle}-released`);
  }
  try {
    const doctor = await cli("doctor");
    expect(doctor.code).toBe(0);
    writeFileSync(join(output, "doctor.json"), JSON.stringify(report(doctor.stdout), null, 2));
    if (reuseBuild) {
      expect(webMode).toBe("start");
      const previousBuildFile = process.env.AIDT_LOCAL_BUILD_EVIDENCE;
      const receiptFile = process.env.AIDT_LOCAL_BUILD_RECEIPT;
      if (!previousBuildFile || !receiptFile || !isAbsolute(previousBuildFile) || !isAbsolute(receiptFile)) throw new Error("Explicit existing-build evidence and receipt paths are required; no build is fabricated or retried.");
      const previousBuild = JSON.parse(readFileSync(previousBuildFile, "utf8")) as { exitCode: number; durationMs: number };
      const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as { apiURL: string; buildId: string };
      expect(previousBuild.exitCode).toBe(0);
      // A new standard reservation must actually select the original API port.
      // Never change the receipt or inject a previously released lease object.
      expect(receipt.apiURL).toBe(origin);
      evidence.prebuild = { reusedBuild: true, previousBuildFile, receiptFile, buildId: receipt.buildId, originalBuildDurationMs: previousBuild.durationMs };
    } else if (webMode === "start") {
      expect(existsSync(join(dataDir, "run", "aidt-owner.json"))).toBe(false);
      const pgdataBeforeBuild = existsSync(join(dataDir, "pgdata"));
      const beforeDigest = pgdataDigest(join(dataDir, "pgdata"));
      const buildStarted = Date.now();
      // The prior assertion rejects any existing owner. Remember only the new
      // build instance, so failure cleanup cannot stop a later/different owner.
      const watchBuildOwner = setInterval(() => { buildOwnerInstance ??= ownerInstance(); }, 100);
      let built: Awaited<ReturnType<typeof cli>>;
      try { built = await cli("build", 1_200_000, join(output, "native-build.log")); }
      catch (error) {
        const failed = { exitCode: null, durationMs: Date.now() - buildStarted, error: error instanceof Error ? error.message : "Build failed" };
        evidence.prebuild = failed;
        writeFileSync(join(output, "native-build.json"), JSON.stringify(failed, null, 2));
        throw error;
      }
      finally { clearInterval(watchBuildOwner); buildOwnerInstance ??= ownerInstance(); }
      const buildResult = { exitCode: built.code, durationMs: Date.now() - buildStarted, pgdataBeforeBuild, pgdataAfterBuild: existsSync(join(dataDir, "pgdata")), pgdataUnchangedByBuild: beforeDigest === pgdataDigest(join(dataDir, "pgdata")) };
      writeFileSync(join(output, "native-build.json"), JSON.stringify(buildResult, null, 2));
      evidence.prebuild = buildResult;
      expect(built.code).toBe(0);
      expect(buildResult.pgdataAfterBuild).toBe(pgdataBeforeBuild);
      expect(buildResult.pgdataUnchangedByBuild).toBe(true);
      expect(existsSync(join(dataDir, "run", "aidt-owner.json"))).toBe(false);
      expect((await Promise.all(Object.values(ports).map(port => free(port)))).every(Boolean)).toBe(true);
    }
    if (trimBuildCache) {
      expect(webMode).toBe("start");
      expect(ownerInstance()).toBe(null);
      const c = resolveLocalConfig({ repoRoot: repo, dataDir, profile: "aidt", ports });
      const outputLease = await acquireWebOutputLease(repo);
      try {
        const dist = webEnv(c).NEXT_DIST_DIR;
        if (!dist) throw new Error("The AIDT profile must identify its own build output.");
        const receiptFile = join(repo, "apps/web", dist, "aidt-local-build-receipt.json");
        const cache = join(repo, "apps/web", dist, "cache");
        const beforeCheck = checkAidtWebBuild(c), beforePg = pgdataDigest(join(dataDir, "pgdata"));
        expect(beforeCheck.usable).toBe(true);
        const beforeReceipt = readFileSync(receiptFile);
        const beforeDisk = statfsSync(repo);
        if (existsSync(cache)) {
          const stat = lstatSync(cache);
          expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true);
          rmSync(cache, { recursive: true });
        }
        const afterCheck = checkAidtWebBuild(c), afterDisk = statfsSync(repo);
        const trimmed = { target: cache, beforeCheck, afterCheck, receiptUnchanged: beforeReceipt.equals(readFileSync(receiptFile)), pgdataUnchanged: beforePg === pgdataDigest(join(dataDir, "pgdata")), freeGiBBefore: beforeDisk.bavail * beforeDisk.bsize / 1024 ** 3, freeGiBAfter: afterDisk.bavail * afterDisk.bsize / 1024 ** 3 };
        writeFileSync(join(output, "native-cache-trim.json"), JSON.stringify(trimmed, null, 2));
        evidence.cacheTrim = trimmed;
        expect(afterCheck.usable).toBe(true);
        expect(trimmed.receiptUnchanged && trimmed.pgdataUnchanged).toBe(true);
      } finally { await outputLease.close(); }
    }
    await start(1);
    const secretsBefore = createHash("sha256").update(readFileSync(join(dataDir, "secrets.json"))).digest("hex");
    await login(page);
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
    privateTraceStarted = true;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) phase(`browser-route ${new URL(frame.url()).pathname}${new URL(frame.url()).search}`); });
    page.on("response", response => {
      const path = new URL(response.url()).pathname;
      if (response.url().startsWith(origin) && (response.request().method() !== "GET" || response.status() >= 400)) phase(`http ${response.request().method()} ${path} ${response.status()}`);
    });
    phase("logged-in-private-post-login-trace-started");
    await page.getByTestId("rail-aidt").click();
    await page.getByTestId("aidt-new").click();
    await page.getByTestId("project-new-name").fill(`本地持久验收 ${randomUUID().slice(0, 8)}`);
    const createStarted = Date.now();
    const createResponse = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/projects");
    await page.getByTestId("project-new-create").click();
    const created = await createResponse;
    expect(created.status()).toBeLessThan(300);
    evidence.projectCreateApiMs = Date.now() - createStarted;
    // Keep the first real navigation visible in both modes; never prewarm it.
    await expect(page).toHaveURL(/\/aidt\/[^/?]+$/, { timeout: 240_000 });
    await expect(page.getByTestId("aidt-step-1")).toBeVisible({ timeout: 240_000 });
    evidence.projectCreateRouteMs = Date.now() - createStarted;
    const projectId = new URL(page.url()).pathname.split("/").pop()!;
    evidence.projectId = projectId;
    const statement = `真实本地保存 ${randomUUID()}：研究学生取餐时的等待体验。`;
    await page.getByTestId("aidt-step-1").click();
    await page.getByTestId("aidt-open-output").click();
    await page.setViewportSize({ width: 1280, height: 900 });
    const heading = page.getByTestId("aidt-workspace").locator(":scope > header h1");
    await expect(heading).toHaveCSS("font-size", "20px");
    await expect(heading).toHaveCSS("clip", "auto");
    expect((await heading.boundingBox())!.height).toBeGreaterThan(20);
    const headingCss = await heading.evaluate(node => ({ fontSize: getComputedStyle(node).fontSize, clip: getComputedStyle(node).clip, height: node.getBoundingClientRect().height }));
    await page.getByRole("button", { name: "AI 引导师", exact: true }).click();
    const assistant = page.getByTestId("aidt-assistant-panel");
    await expect(assistant).toHaveCSS("position", "absolute");
    await expect(assistant).toHaveCSS("max-width", "448px");
    expect((await assistant.boundingBox())!.width).toBeLessThanOrEqual(448);
    const desktopCss = await assistant.evaluate(node => ({ position: getComputedStyle(node).position, maxWidth: getComputedStyle(node).maxWidth, width: node.getBoundingClientRect().width }));
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(assistant).toHaveCSS("position", "fixed");
    await expect(assistant).toBeInViewport({ ratio: 0.99 });
    evidence.featureCss = { heading: headingCss, desktop: desktopCss, mobile: await assistant.evaluate(node => ({ position: getComputedStyle(node).position, height: node.getBoundingClientRect().height, viewport: innerHeight })) };
    await page.getByRole("button", { name: "关闭 AI 引导师", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("初始问题", { exact: true }).fill(statement);
    await page.getByTestId("aidt-problem-reflection-why").fill("可能影响午间取餐体验；只是验收教学示例，值得研究的原因仍待核实。");
    await page.getByTestId("aidt-problem-source-guess").check();
    await page.getByTestId("aidt-problem-reflection-details").fill("目前只是学生猜测：可能不知道在哪里等餐；没有采访或现场观察证据。");
    await page.getByTestId("aidt-problem-reflection-confirm").click();
    await page.getByTestId("aidt-shared-save").click();
    await expect(page.getByTestId("aidt-shared-receipt")).toContainText("V1");
    const saved = await api(page, `/projects/${projectId}/aidt/stages/1`);
    expect(saved.status).toBe(200);
    expect(Object.values(saved.data.stage.content.draft.fields)).toContain(statement);
    expect(saved.data.stage.content.draft.fields).toMatchObject({ problemReflectionConfirmed: "true", problemSources: '["guess"]' });
    evidence.stageRevision = saved.data.stage.revision;
    const generationRequests: string[] = [];
    const watchGeneration = (request: Request) => {
      if (request.method() === "POST" && (/\/agent\/[^/]+\/run$/.test(new URL(request.url()).pathname) || /\/pm-designs\/[^/]+\/chat$/.test(new URL(request.url()).pathname))) generationRequests.push(new URL(request.url()).pathname);
    };
    page.on("request", watchGeneration);
    const v2 = await nativeV2Journey(page, projectId);
    phase("v2-ui-branches-and-report-complete");
    expect(generationRequests).toEqual([]);
    evidence.v2 = { ...v2, generationRequests };
    const humanText = `纯成员文字持久验收 ${randomUUID()}`;
    await page.getByTestId("global-member-chat-open").click();
    await page.getByTestId("project-member-input").fill(humanText);
    await page.getByTestId("project-member-send").click();
    await expect(page.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
    const initialMessages = await api(page, `/projects/${projectId}/member-chat/messages`);
    expect(initialMessages.status).toBe(200);
    expect(initialMessages.data.items.filter((m: { text: string }) => m.text === humanText)).toHaveLength(1);
    expect(generationRequests).toEqual([]);
    await page.screenshot({ path: join(output, "native-member-stored.png"), fullPage: true });
    await page.getByTestId("global-member-chat-close").click();
    await page.setViewportSize({ width: 1280, height: 900 });
    const memberTextNavigation = await acceptAidtMemberText({ page, projectId, toStep: 1,
      request: (path, method, body) => api(page, path, method, body),
      checkpoint: async (name, checkpointPage) => { await checkpointPage.screenshot({ path: join(output, `native-member-${name}.png`), fullPage: true }); },
    });
    evidence.memberTextNavigation = memberTextNavigation;
    expect(generationRequests).toEqual([]);
    const memberMultiuser = await acceptAidtMemberMultiuser({ owner: page, browser, apiOrigin: origin, projectId,
      checkpoint: async name => { phase(`member-multiuser-${name}`); await page.screenshot({ path: join(output, "native-member-multiuser.png"), fullPage: true }); },
    });
    evidence.memberMultiuser = memberMultiuser;
    expect(generationRequests).toEqual([]);
    await stop(1);
    await start(2);
    expect(createHash("sha256").update(readFileSync(join(dataDir, "secrets.json"))).digest("hex")).toBe(secretsBefore);
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${ports.web}` });
    try {
      const anonymous = await context.request.get(`${origin}/projects/${projectId}/aidt/stages/6/revisions?limit=1`);
      expect(anonymous.status()).toBe(401);
      const deniedBody = await anonymous.text();
      const deniedData = JSON.parse(deniedBody) as Record<string, unknown>;
      for (const key of ["items", "stage", "content", "current"]) expect(deniedData).not.toHaveProperty(key);
      for (const field of ["returnReason", "questionSnapshot", "markdown"]) expect(deniedBody).not.toContain(field);
      expect(deniedBody).not.toContain(statement);
      expect(deniedBody).not.toContain(v2.returnRounds[0]!.content.draft.fields.returnReason!);
      expect(deniedBody).not.toContain(v2.saved[6]!.content.summaryReport!.markdown);
      evidence.anonymousHistoryDenied = true;
      const fresh = await context.newPage(); await login(fresh);
      fresh.on("request", watchGeneration);
      await fresh.goto(`/aidt/${projectId}?step=1&tool=outcome`);
      await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(statement, { timeout: 60_000 });
      const restored = await api(fresh, `/projects/${projectId}/aidt/stages/1`);
      expect(restored).toEqual(saved);
      await expect(fresh.getByTestId("aidt-problem-source-guess")).toBeChecked();
      await expect(fresh.getByTestId("aidt-problem-reflection-status")).toContainText("已确认");
      for (const [stage, expected] of Object.entries(v2.saved)) {
        const restoredV2 = await api(fresh, `/projects/${projectId}/aidt/stages/${stage}`);
        expect(restoredV2.status).toBe(200);
        expect(SharedStage.parse(restoredV2.data.stage)).toEqual(expected);
      }
      for (const round of v2.returnRounds) await readHistoricalReturn(fresh, projectId, round, v2.saved[6]!);
      evidence.historicalReturnsAfterRestart = v2.returnRounds.map(round => ({ step: Number(round.content.draft.fields.returnStep), revision: round.revision, headRevision: v2.saved[6]!.revision }));
      await openOutcome(fresh, projectId, 3);
      await expect(fresh.getByRole("radio", { name: "暂无意外发现", exact: true })).toBeChecked();
      await expect(fresh.getByTestId("aidt-surprise-status")).toContainText("已由学生确认");
      await openOutcome(fresh, projectId, 4);
      await expect(fresh.getByRole("radio", { name: "拟选择候选 2（不是投票）", exact: true })).toBeChecked();
      await expect(fresh.getByRole("checkbox", { name: "验收示例：纸面取餐提示 · 最容易实现的", exact: true })).toBeChecked();
      await expect(fresh.getByRole("checkbox", { name: "验收示例：纸面取餐提示 · 最有趣的", exact: true })).toBeChecked();
      await openOutcome(fresh, projectId, 5);
      await expect(fresh.getByRole("textbox", { name: "通过这次制作原型，你最想知道什么？", exact: true })).toHaveValue(v2.saved[5]!.content.draft.fields.verificationQuestion!);
      await openOutcome(fresh, projectId, 6);
      await expect(fresh.getByTestId("aidt-bound-question")).toContainText("学生能否看懂纸面取餐分区提示");
      await expect(fresh.getByTestId("aidt-test-reflection").getByRole("combobox", { name: "测试之后，对这个问题的认识有什么变化？", exact: true })).toHaveValue("insufficient");
      await expect(fresh.getByTestId("aidt-round-navigation").getByRole("link")).toHaveAttribute("href", new RegExp(`/aidt/${projectId}\\?step=2&tool=outcome&returnRevision=`));
      await fresh.goto(`/aidt/${projectId}?step=6&tool=report`);
      await expect(fresh.getByTestId("aidt-report-reload")).toBeEnabled();
      const restoredReport = fresh.getByLabel("小组报告草稿", { exact: true });
      await expect(restoredReport).toHaveValue(v2.historyReport.reportText);
      const restoredReportText = await restoredReport.inputValue();
      for (const text of [v2.historyReport.chapter, v2.historyReport.manualMarker, v2.returnRounds[0]!.content.draft.fields.returnReason!, "没有服务器保存记录，材料缺失"]) expect(restoredReportText).toContain(text);
      await fresh.goto(`/aidt/${projectId}?step=1&tool=outcome`);
      await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(statement);
      const messages = await api(fresh, `/projects/${projectId}/member-chat/messages`);
      expect(messages.status).toBe(200);
      expect(messages.data.items.some((m: { text: string }) => m.text === humanText)).toBe(true);
      expect(messages.data.items.find((message: { id: string }) => message.id === memberTextNavigation.root.id)).toEqual(memberTextNavigation.root);
      const restoredTopic = await api(fresh, `/projects/${projectId}/member-chat/messages/${memberTextNavigation.root.id}/replies?limit=100`);
      expect(restoredTopic.status).toBe(200);
      expect(restoredTopic.data.root).toEqual(memberTextNavigation.root);
      expect(restoredTopic.data.items.filter((message: { clientMessageId: string }) => message.clientMessageId === memberTextNavigation.reply.clientMessageId)).toEqual([memberTextNavigation.reply]);
      evidence.memberTextTopicRestoredAfterRestart = true;
      const restoredMultiuser = await api(fresh, `/projects/${projectId}/member-chat/messages?limit=100`);
      expect(restoredMultiuser.status).toBe(200);
      const restoredChannel = memberChat.operations.listMessages.out.parse(restoredMultiuser.data);
      const multiuserRoots = memberMultiuser.messages.filter(message => message.threadRootId === null);
      expect(new Set(memberMultiuser.authors).size).toBe(2);
      expect(multiuserRoots).toHaveLength(2);
      expect(new Set(multiuserRoots.map(message => message.authorId))).toEqual(new Set(memberMultiuser.authors));
      for (const root of multiuserRoots) {
        expect(restoredChannel.items.filter(message => message.clientMessageId === root.clientMessageId)).toEqual([root]);
        const replyResponse = await api(fresh, `/projects/${projectId}/member-chat/messages/${root.id}/replies?limit=100`);
        expect(replyResponse.status).toBe(200);
        const restoredReplies = memberChat.operations.listReplies.out.parse(replyResponse.data);
        expect(restoredReplies.root).toEqual(root);
        const expectedReplies = memberMultiuser.messages.filter(message => message.threadRootId === root.id);
        expect(expectedReplies).toHaveLength(1);
        expect(expectedReplies[0]!.authorId).not.toBe(root.authorId);
        expect(restoredReplies.items).toEqual(expectedReplies);
      }
      evidence.memberMultiuserRestoredAfterRestart = true;
      await fresh.setViewportSize({ width: 375, height: 812 });
      await fresh.screenshot({ path: join(output, "native-stage-after-restart-375.png"), fullPage: true });
      await fresh.getByTestId("global-member-chat-open").click();
      await expect(fresh.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
      const continuedHumanText = `重启后继续讨论 ${randomUUID()}：先核对旧轮次，再由学生决定下一步。`;
      await fresh.getByTestId("project-member-input").fill(continuedHumanText);
      await fresh.getByTestId("project-member-send").click();
      await expect(fresh.getByTestId("project-member-message").filter({ hasText: continuedHumanText }).first()).toHaveAttribute("data-delivery", "stored");
      const continuedMessages = await api(fresh, `/projects/${projectId}/member-chat/messages`);
      expect(continuedMessages.status).toBe(200);
      for (const text of [humanText, continuedHumanText]) expect(continuedMessages.data.items.filter((m: { text: string }) => m.text === text)).toHaveLength(1);
      expect(generationRequests).toEqual([]);
      evidence.humanTextContinuesAfterRestart = true;
      await fresh.screenshot({ path: join(output, "native-member-after-restart-375.png"), fullPage: true });
      evidence.projectId = projectId; evidence.stageRevision = restored.data.stage.revision;
      evidence.memberMessagesReadBack = messages.data.items.length; evidence.secretsPreserved = true;
    } finally { await context.close(); }
    await stop(2);
    const leasePortsFree = await Promise.all(leasePorts.map(async port => ({ port, free: await free(port) })));
    expect(leasePortsFree).toHaveLength(13);
    expect(leasePortsFree.every(item => item.free)).toBe(true);
    evidence.leasePortsFree = leasePortsFree;
    evidence.nativeStartStopCycles = 2;
    evidence.completed = true;
  } finally {
    try {
      if (owner && ownerCode === null) { await cli("stop", 150_000).catch(() => undefined); await ownerExit; }
      if (buildOwnerInstance !== null && ownerInstance() === buildOwnerInstance) {
        const stopped = await cli("stop", 150_000);
        evidence.buildOwnerCleanupExitCode = stopped.code;
        expect(stopped.code).toBe(0);
        await expect.poll(ownerInstance, { timeout: 15_000 }).toBe(null);
      }
    } finally {
      if (privateTraceStarted) {
        // This private diagnostic may contain local test session headers. Never package or upload it.
        const tracePath = join(output, "private-post-login-trace.zip");
        try { await page.context().tracing.stop({ path: tracePath }); chmodSync(tracePath, 0o600); evidence.privateTrace = "retained internally only; excluded from deliverables"; }
        catch { evidence.privateTrace = "trace finalization unavailable"; }
      }
      writeFileSync(join(output, "persistent-roundtrip.json"), JSON.stringify(evidence, null, 2));
    }
  }
});
