#!/usr/bin/env node
/**
 * 本地真栈会话实测：设计工作台（「普通人做原型」那条路）从新建到分享收回，走一遍、截图、出报告。
 *
 * ## 这是什么，不是什么
 *
 * 是**真栈**：本地版（PGlite + 文件会话 + 真 API + 真 Web）起在本机，浏览器是真 Chromium，
 * 每一步都读真实的屏幕与真实的下载事件。它补的是单测与 `/preview` 场景够不到的那一层——
 * 「登录、落库、刷新之后还在、访客真的打不开了」。
 *
 * 不是模型质量测试：本机没有可用模型时，自动起 `standin-model.mjs` 占住 Ollama 端口，
 * 回一套写死的两页原型（报告里写明用的是哪一种）。
 *
 * 不进 CI：它要一整套本地栈，跑一次三五分钟。是给人（和 agent）手动跑、留证据用的，
 * 同 `pnpm run e2e:real-model-smoke` 的定位。
 *
 * ## 用法
 *
 *   # 1. 起本地栈（见 docs/deployment/LOCAL-DESKTOP.md）；在远程执行容器里 2024 被沙箱自己占着，要挪端口：
 *   pnpm --filter @repo/local-runtime run up -- --data-dir <dir> --no-pull [--ports deepAgent=2124]
 *   # 2. 跑这一趟
 *   node scripts/local-session/design-loop-session.mjs --data-dir <dir> [--base http://127.0.0.1:3100] [--out <dir>]
 *
 * 输出：`<out>/report.md` + 截图 + `results.json` + `calls.log`（替身模型被问了什么）。
 * 默认 `<out>` = `evidence/local-desktop/design-loop-<日期>/`。
 * 退出码：有一步失败就是 1——报告照样写完，失败那一步附截图。
 *
 * 账号密码从 `<data-dir>/secrets.json` 读，**不写进报告**。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStandinModel } from "./standin-model.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
/** 东八区日期：文件名与报告里的日期都按用户所在时区算（同 `localDateStamp` 那条教训）。 */
const cnDate = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const BASE = arg("base", "http://127.0.0.1:3100");
const DATA = resolve(arg("data-dir", join(homedir(), ".workspacex-local")));
const OUT = resolve(arg("out", join(ROOT, "evidence", "local-desktop", `design-loop-${cnDate()}`)));
mkdirSync(OUT, { recursive: true });

// playwright-core 装在 apps/web 下（本仓唯一带它的 workspace）。
const { chromium } = createRequire(join(ROOT, "apps", "web", "package.json"))("playwright-core");

const portFree = (port) => new Promise((r) => {
  const s = createServer();
  s.once("error", () => r(false));
  s.listen(port, "127.0.0.1", () => s.close(() => r(true)));
});

const secrets = JSON.parse(readFileSync(join(DATA, "secrets.json"), "utf8"));
const password = secrets.adminPassword ?? secrets.password
  ?? Object.values(secrets).find((v) => typeof v === "string" && v.length >= 12);
if (typeof password !== "string") throw new Error(`读不到 ${join(DATA, "secrets.json")} 里的本地账号密码`);

/** 模型：11434 空着 ⇒ 起替身；被占着 ⇒ 当作本机真 Ollama（报告里如实写）。 */
const modelMode = (await portFree(11434)) ? "standin" : "existing";
const standin = modelMode === "standin" ? await startStandinModel({ port: 11434, logDir: OUT }) : null;

const results = [];
const findings = [];
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

const shot = async (name, target = page) => { await target.screenshot({ path: join(OUT, name) }).catch(() => {}); return name; };
const step = async (id, title, fn) => {
  const t0 = Date.now();
  try {
    const r = (await fn()) ?? {};
    results.push({ id, title, ok: true, detail: r.detail ?? "", shot: r.shot ?? null, ms: Date.now() - t0 });
    console.log("PASS", id, title, r.detail ?? "");
  } catch (e) {
    const detail = String(e?.message ?? e).split("\n")[0];
    results.push({ id, title, ok: false, detail, shot: await shot(`fail-${id}.png`), ms: Date.now() - t0 });
    console.log("FAIL", id, title, detail);
  }
};
const exportName = async (testid) => {
  await page.getByTestId("design-detail-export").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testid).click()]);
  return dl.suggestedFilename();
};
const PROJECT = "会员下单";
const STEM = "hui-yuan-xia-dan";

await step("S01", "用本地账号登录", async () => {
  await page.goto(`${BASE}/login`);
  await page.getByTestId("login-email").fill("me@local.workspacex");
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return { detail: `登录后落地 ${new URL(page.url()).pathname}` };
});

await step("S02", "打开设计工作台（真栈 listMyProjects）", async () => {
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.getByTestId("design-workbench").waitFor();
  return { detail: (await page.getByTestId("empty").count()) > 0 ? "空工作台，出现起手卡片" : "已有项目", shot: await shot("s02-workbench.png") };
});

await step("S03", `新建「${PROJECT}」并自动开画`, async () => {
  await page.getByTestId("workbench-new").click();
  await page.getByTestId("project-dialog-name").fill(PROJECT);
  await page.getByTestId("project-dialog-problem").fill("老会员打开就能下单，三步以内完成");
  await page.getByTestId("intake-skip-all").click();
  await page.waitForURL(/\/studio\/design-workbench\/[^/?]+/);
  await page.getByTestId("design-detail-frame-1").waitFor({ timeout: 180_000 });
  const frames = await page.locator('[data-testid^="design-detail-frame-"]').allInnerTexts();
  return { detail: `画出 ${frames.length} 页：${frames.map((f) => f.trim().replace(/\s+/g, " ")).join(" / ")}`, shot: await shot("s03-drawn.png") };
});

await step("S04", "详情页底栏「更新于」说人话，不是机器日期", async () => {
  // 2026-09-23 这一步第一次跑时是观察项，抓到底栏写着「2026/9/23」；修掉之后改成断言。
  const bar = (await page.getByTestId("design-detail-statusbar-updated").innerText()).trim();
  if (/\d{4}\/\d{1,2}\/\d{1,2}/.test(bar)) throw new Error(`底栏还是机器日期：「${bar}」`);
  if (!/刚刚|分钟前|今天/.test(bar)) findings.push(`刚建好的项目，底栏写的却是「${bar}」`);
  return { detail: `底栏：「${bar}」` };
});

await step("S05", "导出可点击原型：中文项目名转拼音（#3887）", async () => {
  const name = await exportName("design-detail-export-html");
  const want = `${STEM}-prototype-${cnDate()}.html`;
  if (name !== want) throw new Error(`拿到 ${name}，期望 ${want}`);
  return { detail: name };
});

await step("S06", "导出设计文档 / 原型规格：同一套拼音规则", async () => {
  const md = await exportName("design-detail-export-doc");
  const json = await exportName("design-detail-export-json");
  if (!md.startsWith(`${STEM}-`) || !md.endsWith(".md")) throw new Error(`md=${md}`);
  if (!json.startsWith(`${STEM}-`) || !json.endsWith(".prototype.json")) throw new Error(`json=${json}`);
  return { detail: `${md} · ${json}` };
});

await step("S07", "导出当前页截图：页名「首页」也转拼音", async () => {
  const png = await exportName("design-detail-export-png");
  if (png !== `${STEM}-shou-ye.png`) throw new Error(`拿到 ${png}`);
  return { detail: png };
});

await step("S08", "属性面板：改了没按应用就点别处 ⇒ 自动应用、说出来、刷新后还在（#3882 R19）", async () => {
  const single = page.getByTestId("design-detail-view-single");
  if (await single.count()) await single.click();
  await page.getByTestId("design-detail-frame-0").click();
  const tree = () => page.getByTestId("design-detail-phone-tree").first();
  await tree().locator('[data-node-id="home-cta"]').click();
  await page.getByTestId("design-inspector-label").fill("马上下单");
  await tree().locator('[data-node-id="home-intro"]').click();
  const note = (await page.getByTestId("design-inspector-auto-applied").innerText({ timeout: 20_000 })).trim();
  const s = await shot("s08-auto-applied.png");
  await page.reload();
  await page.getByTestId("design-detail").waitFor();
  if (!(await tree().innerText()).includes("马上下单")) throw new Error("刷新后改动不在——自动应用没有真的落库");
  return { detail: `提示「${note.slice(0, 36)}…」；刷新后仍是「马上下单」`, shot: s };
});

let shareUrl = "";
await step("S09", "分享：发布拿到链接；访客（无登录）打开只读页", async () => {
  await page.getByTestId("design-detail-share").click();
  await page.getByTestId("design-share-publish").click();
  shareUrl = await page.getByTestId("design-share-url").inputValue({ timeout: 20_000 });
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await guestCtx.newPage();
  await guest.goto(shareUrl);
  await guest.getByTestId("shared-design-view").waitFor();
  const name = await guest.getByTestId("shared-design-name").innerText();
  const s = await shot("s09-guest-mobile.png", guest);
  await guestCtx.close();
  return { detail: `访客（手机宽度、未登录）看到「${name}」`, shot: s };
});

await step("S10", "取消发布先确认；「算了」不收回，确认后访客打不开（#3882 R20）", async () => {
  await page.getByTestId("design-share-unpublish").click();
  await page.getByTestId("design-share-unpublish-confirm").waitFor();
  const s = await shot("s10-unpublish-confirm.png");
  await page.getByTestId("design-share-unpublish-cancel").click();
  if ((await page.getByTestId("design-share-url").count()) !== 1) throw new Error("点「算了」之后链接没了");
  await page.getByTestId("design-share-unpublish").click();
  await page.getByTestId("design-share-unpublish-yes").click();
  await page.getByTestId("design-share-url").waitFor({ state: "detached", timeout: 20_000 });
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(shareUrl);
  const msg = (await guest.getByTestId("shared-design-error").innerText()).trim();
  await guestCtx.close();
  await page.keyboard.press("Escape");
  return { detail: `收回后访客看到「${msg.slice(0, 28)}…」`, shot: s };
});

await step("S11", "工作台：删除项目先确认，「算了」不删；卡片时间是人话（#3882 R18）", async () => {
  await page.goto(`${BASE}/studio/design-workbench`);
  const card = page.locator('[data-testid^="project-card-"]').first();
  await card.waitFor();
  const id = (await card.getAttribute("data-testid")).replace("project-card-", "");
  const when = ((await card.innerText()).match(/改于 [^\n]+/) ?? ["（没找到「改于」）"])[0];
  await page.getByTestId(`project-delete-${id}`).click();
  await page.getByTestId("workbench-delete-confirm").waitFor();
  const s = await shot("s11-delete-confirm.png");
  await page.getByTestId("workbench-delete-cancel").click();
  await page.getByTestId(`project-card-${id}`).waitFor();
  return { detail: `卡片写「${when}」；点「算了」后项目还在`, shot: s };
});

await step("S12", "悬停反馈：访谈页未选中的页签悬停变成正文色（#3894）", async () => {
  // `interview-studio-home.tsx` 的页签：未选中态 `text-muted-foreground hover:text-background-foreground`。
  // #3894 之前写的是 `hover:text-foreground`——那个类不存在，悬停时颜色纹丝不动。
  await page.goto(`${BASE}/itv`);
  const tab = page.getByTestId("itv-tab-experts");
  await tab.waitFor({ timeout: 180_000 });
  if ((await tab.getAttribute("aria-selected")) === "true") throw new Error("「专家列表」恰好是选中态，测不了未选中的悬停");
  const color = () => tab.evaluate((e) => getComputedStyle(e).color);
  await page.mouse.move(1400, 880);
  const idle = await color();
  await tab.hover();
  await page.waitForTimeout(400);
  const hover = await color();
  if (idle === hover) throw new Error(`悬停前后都是 ${idle}`);
  return { detail: `idle ${idle} → hover ${hover}` };
});

await browser.close();
if (standin !== null) await standin.close();

/* ── 报告 ─────────────────────────────────────────────────────────────── */
const sha = (() => { try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "（读不到）"; } })();
/** 工作区有没提交的改动 ⇒ 报告里的版本号不代表被测的代码，必须说出来（2026-09-23 第一次跑就踩到）。 */
const dirty = (() => { try { return execSync("git status --porcelain -- apps packages", { cwd: ROOT, encoding: "utf8" }).trim() !== ""; } catch { return false; } })();
const calls = existsSync(join(OUT, "calls.log")) ? readFileSync(join(OUT, "calls.log"), "utf8").trim().split("\n") : [];
const kinds = calls.reduce((m, l) => { const k = l.split(" ").pop(); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const passed = results.filter((r) => r.ok).length;
const md = [
  `# 本地真栈会话实测：设计工作台（${cnDate()}）`,
  "",
  "> 由 `scripts/local-session/design-loop-session.mjs` 生成。重跑方法见该文件头注。",
  "",
  "## 环境",
  "",
  "| 项 | 值 |",
  "|---|---|",
  `| 代码版本 | \`${sha}\`${dirty ? "（⚠ 工作区有未提交的改动——被测的不完全是这个提交）" : ""} |`,
  "| 后端 | 本地版 `packages/local-runtime`（PGlite + 文件会话 + 真 API + 真 Web） |",
  `| 浏览器 | Chromium（Playwright），1440×900，zh-CN，Asia/Shanghai；访客一步用 390×844 |`,
  `| 模型 | ${modelMode === "standin" ? "替身模型 `scripts/local-session/standin-model.mjs`（本机没有可用模型；回写死的两页原型——**不是**模型质量证据）" : "本机已有的模型服务（占着 11434）"} |`,
  ...(modelMode === "standin" ? [`| 替身模型被调用 | ${calls.length} 次：${Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join("，")}（产品按「骨架轮 → 逐页」的真实顺序调用） |`] : []),
  "",
  `## 结果：${passed}/${results.length} 通过`,
  "",
  "| # | 步骤 | 结果 | 看到了什么 | 截图 |",
  "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${r.title} | ${r.ok ? "✅" : "❌"} | ${r.detail.replace(/\|/g, "\\|")} | ${r.shot ? `[${r.shot}](./${r.shot})` : ""} |`),
  "",
  "## 发现",
  "",
  ...(findings.length > 0 ? findings.map((f) => `- ${f}`) : ["- 无"]),
  "",
  "## 浏览器控制台报错",
  "",
  ...(consoleErrors.length > 0 ? ["```", ...consoleErrors.slice(0, 15), "```"] : ["- 无"]),
  "",
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ sha, modelMode, results, findings, consoleErrors }, null, 2));
console.log(`\n报告：${relative(process.cwd(), join(OUT, "report.md"))}（${passed}/${results.length} 通过）`);
process.exit(passed === results.length ? 0 : 1);
