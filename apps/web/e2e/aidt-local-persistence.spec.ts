import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, isAbsolute } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LOCAL_ADMIN_EMAIL, resolveLocalConfig, webEnv } from "../../../packages/local-runtime/src/config";
import { acquireWebOutputLease, checkAidtWebBuild } from "../../../packages/local-runtime/src/aidt-web-build";
import { SharedStage } from "@repo/contracts/aidt-stages";
import type { z } from "zod";

const repo = resolve(process.cwd(), "../..");
const dataDir = process.env.AIDT_LOCAL_DATA_DIR!;
const webMode = process.env.AIDT_LOCAL_WEB_MODE ?? "dev";
const reuseBuild = process.env.AIDT_LOCAL_REUSE_BUILD === "1";
const trimBuildCache = process.env.AIDT_LOCAL_TRIM_BUILD_CACHE === "1";
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
async function api(page: Page, path: string) {
  return page.evaluate(async ({ origin, path }) => {
    const r = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${localStorage.getItem("wsx.sessionToken")}` } });
    return { status: r.status, data: await r.json() };
  }, { origin, path });
}
type NativeStage = z.infer<typeof SharedStage>;
function phase(name: string) { console.info(`[aidt-native] ${new Date().toISOString()} ${name}`); }
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
  const reportText = await page.getByLabel("小组报告草稿", { exact: true }).inputValue();
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
  return { saved, branches, prototypeInputIsStudentText: true, actualGeneratedPrototype: false, actualResearchCollected: false };
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
    page.on("request", request => {
      if (request.method() === "POST" && (/\/agent\/[^/]+\/run$/.test(new URL(request.url()).pathname) || /\/pm-designs\/[^/]+\/chat$/.test(new URL(request.url()).pathname))) generationRequests.push(new URL(request.url()).pathname);
    });
    const v2 = await nativeV2Journey(page, projectId);
    phase("v2-ui-branches-and-report-complete");
    expect(generationRequests).toEqual([]);
    evidence.v2 = { ...v2, generationRequests };
    const humanText = `纯成员文字持久验收 ${randomUUID()}`;
    await page.getByTestId("global-member-chat-open").click();
    await page.getByTestId("project-member-input").fill(humanText);
    await page.getByTestId("project-member-send").click();
    await expect(page.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
    await page.screenshot({ path: join(output, "native-member-stored.png"), fullPage: true });
    await page.getByTestId("global-member-chat-close").click();
    await stop(1);
    await start(2);
    expect(createHash("sha256").update(readFileSync(join(dataDir, "secrets.json"))).digest("hex")).toBe(secretsBefore);
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${ports.web}` });
    try {
      const fresh = await context.newPage(); await login(fresh);
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
      await fresh.goto(`/aidt/${projectId}?step=1&tool=outcome`);
      await expect(fresh.getByLabel("初始问题", { exact: true })).toHaveValue(statement);
      const messages = await api(fresh, `/projects/${projectId}/member-chat/messages`);
      expect(messages.status).toBe(200);
      expect(messages.data.items.some((m: { text: string }) => m.text === humanText)).toBe(true);
      await fresh.setViewportSize({ width: 375, height: 812 });
      await fresh.screenshot({ path: join(output, "native-stage-after-restart-375.png"), fullPage: true });
      await fresh.getByTestId("global-member-chat-open").click();
      await expect(fresh.getByTestId("project-member-message").filter({ hasText: humanText }).first()).toHaveAttribute("data-delivery", "stored");
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
