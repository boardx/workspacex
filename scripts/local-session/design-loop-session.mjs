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
/*
 * 假麦克风：没有它，语音那一步在浏览器这一侧就失败了（「没有找到可用的麦克风设备」），
 * 请求根本到不了服务端——2026-09-23 拿旧代码反证时正是这样，S14 测的其实是另一条路。
 */
const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", permissions: ["microphone"] });
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

await step("S13", "手机宽度（375）打开设计详情：画布读得了字，不是一张缩略图", async () => {
  // 2026-09-23 第二次实测抓到：高度只剩 291px，两头都装下的缩放是 0.29（正文约 4px）。
  const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const phone = await phoneCtx.newPage();
  phone.setDefaultTimeout(120_000);
  await phone.goto(`${BASE}/login`);
  await phone.getByTestId("login-email").fill("me@local.workspacex");
  await phone.getByTestId("login-password").fill(password);
  await phone.getByTestId("login-submit").click();
  await phone.waitForURL((u) => !u.pathname.startsWith("/login"));
  await phone.goto(`${BASE}/studio/design-workbench`);
  await phone.locator('[data-testid^="project-open-"]').first().click();
  const stage = phone.getByTestId("design-detail-stage");
  await stage.waitFor();
  await phone.waitForTimeout(1500);
  const scale = Number(await stage.getAttribute("data-scale"));
  const s = await shot("s13-phone-detail.png", phone);
  await phoneCtx.close();
  if (!(scale >= 0.5)) throw new Error(`画布缩放 ${String(scale)}——手机上读不了字`);
  return { detail: `画布缩放 ${scale.toFixed(2)}（读得了字；装不下的部分竖着滚）`, shot: s };
});

await step("S14", "提反馈弹窗点「语音」：本机没开通转写时不给死路「重试」、说明不被截断", async () => {
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.getByTestId("rail-feedback").first().click();
  await page.locator("button", { hasText: "语音" }).first().click();
  const bar = page.getByTestId("feedback-voice-error");
  const listening = page.locator('[data-voice-phase="listening"]');
  await Promise.race([bar.waitFor({ timeout: 20_000 }), listening.waitFor({ timeout: 20_000 })]).catch(() => {});
  if ((await bar.count()) === 0) {
    await page.keyboard.press("Escape");
    return { detail: "本机语音转写可用（没有报错）——这一步测不到「没开通」那条路，跳过" };
  }
  // 只依赖新旧两版都有的东西（状态栏本身、按钮文字、渲染出来的版面），这样拿旧代码跑也能按
  // **真正的原因**转红，而不是因为某个新加的 testid 不存在而超时。
  const text = (await bar.innerText()).trim();
  const retries = await page.locator("button", { hasText: "重试" }).count();
  // CSS 截断不改 DOM 文字——innerText 照样是全文。要看的是「渲染出来有没有被省略号吃掉」。
  const clipped = await bar.evaluate((root) => [...root.querySelectorAll("*")].some((e) => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1));
  const s = await shot("s14-voice-not-configured.png");
  await page.keyboard.press("Escape");
  // 按服务端那句话判（「尚未配置」），不按标题——旧代码的标题是「暂时不可用」，按标题判就测不出旧 bug。
  // 报的不是「没开通」⇒ 这一步没走到它要测的那条路，如实失败，不当作通过。
  if (!/尚未配置|没开通/.test(text)) throw new Error(`没走到「没开通」这条路，报的是：「${text.replace(/\s+/g, " ").slice(0, 60)}」`);
  if (retries > 0) throw new Error(`没开通却还有 ${String(retries)} 个「重试」`);
  if (clipped) throw new Error("说明被省略号截断了");
  return { detail: `「${text.slice(0, 40)}…」；「重试」按钮 ${String(retries)} 个`, shot: s };
});

await step("S15", "运营收件箱打得开：系统异常一路读不到时只丢那一路（#3921）", async () => {
  // 本地版的 PGlite 不区分数据库角色，系统异常那一路必然读不到；原来整个收件箱跟着 500。
  await page.goto(`${BASE}/platform-admin/inbox`);
  const dead = page.getByTestId("dep-failed");
  const alive = page.locator('[data-testid="inbox-kind-exception"]');
  await Promise.race([dead.waitFor({ timeout: 120_000 }), alive.waitFor({ timeout: 120_000 })]).catch(() => {});
  const s = await shot("s15-inbox.png");
  if ((await dead.count()) > 0 && (await alive.count()) === 0) throw new Error("整个收件箱读不到（一路失败拖垮了全部）");
  const unavailable = (await page.getByTestId("inbox-exception-unavailable-hint").count()) > 0;
  const withheld = (await page.getByTestId("inbox-exception-withheld-hint").count()) > 0;
  // 按不下去的那一格不许挂数字：服务端这时给的 0 是「没有算」，挂着就读成「系统零异常」
  // （第一次实测截图抓到的）。
  const chipText = (await alive.innerText()).trim();
  if ((unavailable || withheld) && /\d/.test(chipText)) throw new Error(`「系统异常」那一格读不到却挂着数字：「${chipText}」`);
  return {
    detail: unavailable ? "收件箱正常打开；系统异常那一格如实说「这次没读到」（本地版预期）"
      : withheld ? "收件箱正常打开；系统异常仅平台运维可见"
      : "收件箱正常打开；系统异常一路也读到了",
    shot: s,
  };
});

await step("S16", "品牌色与字体：输入 #FF5A1F、选衬线体，刷新后还在（对标 R1，#3933）", async () => {
  // 真栈才测得到的一段：新加的 `tokens` 列与仓储按键合并的 SQL 走的是真 PGlite，不是夹具。
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.locator('[data-testid^="project-open-"]').first().click();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-appearance").click();
  const input = page.getByTestId("design-detail-brand-color");
  await input.fill("#FF5A1F");
  await input.press("Enter");
  await page.getByTestId("design-detail-font-serif").click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.getByTestId("design-detail").waitFor();
  const phone = page.getByTestId("design-detail-phone").first();
  await phone.waitFor();
  const brand = await phone.getAttribute("data-brand");
  const font = await phone.getAttribute("data-font");
  const s = await shot("s16-brand-font.png");
  if (brand !== "#FF5A1F") throw new Error(`刷新后品牌色是「${String(brand)}」，不是 #FF5A1F（没落库？）`);
  if (font !== "serif") throw new Error(`刷新后字体是「${String(font)}」，不是衬线体`);
  // 收尾：换回默认，免得后面重跑这份会话时起点不同。
  await page.getByTestId("design-detail-appearance").click();
  await page.getByTestId("design-detail-brand-clear").click();
  await page.getByTestId("design-detail-font-sans").click();
  await page.waitForTimeout(800);
  return { detail: "刷新后画布根仍是 #FF5A1F + 衬线体（真 PGlite 上的 tokens 列）", shot: s };
});

await step("S17", "批注存在服务端：钉一条，换一个全新的浏览器（空存储）打开同一个项目还看得到（深度 S2，#3988）", async () => {
  // 真栈才测得到的一段：新表 design_project_comments 的迁移、RLS + GRANT、仓储 SQL 走的是真 PGlite。
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.locator('[data-testid^="project-open-"]').first().click();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-view-single").click();
  await page.getByTestId("design-detail-mode-comment").click();
  const text = `真栈批注 ${Date.now().toString(36)}`;
  await page.getByTestId("design-detail-phone").locator("[data-node-id]").nth(1).click();
  await page.getByTestId("design-comment-input").fill(text);
  await page.getByTestId("design-comment-save").click();
  await page.getByTestId("design-comment-item").filter({ hasText: text }).waitFor();

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  const other = await fresh.newPage();
  other.setDefaultTimeout(120_000);
  await other.goto(`${BASE}/login`);
  await other.getByTestId("login-email").fill("me@local.workspacex");
  await other.getByTestId("login-password").fill(password);
  await other.getByTestId("login-submit").click();
  await other.waitForURL((u) => !u.pathname.startsWith("/login"));
  await other.goto(`${BASE}/studio/design-workbench`);
  await other.locator('[data-testid^="project-open-"]').first().click();
  await other.getByTestId("design-detail").waitFor();
  await other.getByTestId("design-detail-view-single").click();
  await other.getByTestId("design-detail-mode-comment").click();
  const item = other.getByTestId("design-comment-item").filter({ hasText: text });
  await item.waitFor({ timeout: 20_000 });
  const pins = await other.getByTestId("design-comment-pin").count();
  const s = await shot("s17-comment-other-browser.png", other);
  await fresh.close();
  if (pins < 1) throw new Error("另一个浏览器里看得到批注，但画布上没有钉");
  // 收尾：删掉这条，免得重跑时越积越多。
  await page.getByTestId("design-comment-item").filter({ hasText: text }).getByRole("button", { name: "删掉这条批注" }).click();
  await page.getByTestId("design-comment-item").filter({ hasText: text }).waitFor({ state: "detached" });
  return { detail: `另一个浏览器（空存储）打开同一个项目，看到「${text}」和它的钉（真 PGlite 上的 design_project_comments）`, shot: s };
});

await step("S18", "批注讨论：回一句、标记解决再重新打开、删掉批注连同回复（深度 S3，#3988）", async () => {
  // 真栈才测得到：回复表只授 SELECT/INSERT，删批注靠外键级联带走回复——这一步证明级联在真库上走得通。
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.locator('[data-testid^="project-open-"]').first().click();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-view-single").click();
  await page.getByTestId("design-detail-mode-comment").click();
  const text = `真栈讨论 ${Date.now().toString(36)}`;
  await page.getByTestId("design-detail-phone").locator("[data-node-id]").nth(1).click();
  await page.getByTestId("design-comment-input").fill(text);
  await page.getByTestId("design-comment-save").click();
  const item = page.getByTestId("design-comment-item").filter({ hasText: text });
  await item.getByTestId("design-comment-reply").click();
  await item.getByTestId("design-comment-reply-input").fill("同意，按这个改");
  await item.getByTestId("design-comment-reply-save").click();
  await item.getByText("同意，按这个改").waitFor();
  await item.getByTestId("design-comment-resolve").click();
  await page.getByTestId("design-comment-item").filter({ hasText: text }).getByTestId("design-comment-reopen").waitFor();
  await page.getByTestId("design-comment-item").filter({ hasText: text }).getByTestId("design-comment-reopen").click();
  await page.reload();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-view-single").click();
  await page.getByTestId("design-detail-mode-comment").click();
  const again = page.getByTestId("design-comment-item").filter({ hasText: text });
  await again.getByText("同意，按这个改").waitFor({ timeout: 20_000 });
  const resolved = await again.getAttribute("data-resolved");
  const s = await shot("s18-comment-thread.png");
  if (resolved !== null) throw new Error("重新打开后刷新，这条仍是已解决（状态没落库？）");
  await again.getByRole("button", { name: "删掉这条批注" }).click();
  await page.getByTestId("design-comment-item").filter({ hasText: text }).waitFor({ state: "detached" });
  const err = await page.getByTestId("design-comments-error").count();
  if (err > 0) throw new Error(`删批注报错：${await page.getByTestId("design-comments-error").textContent()}`);
  return { detail: "回复刷新后还在、重新打开的状态落了库；删掉带回复的批注成功（真库外键级联，回复表不授 DELETE）", shot: s };
});

await step("S19", "真实图片：往占位图里上传一张 2400×1800 的照片，刷新后还在（深度 S10，#3988）", async () => {
  // 真栈才测得到：缩压后的 data URL 要装进**真 API** 的请求体上限（100 KiB），并经 PGlite 的 jsonb 落库再读回。
  await page.goto(`${BASE}/studio/design-workbench`);
  await page.locator('[data-testid^="project-open-"]').first().click();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-view-single").click();
  const phone = page.getByTestId("design-detail-phone");
  const slot = phone.locator('[data-proto="image"]').first();
  if ((await slot.count()) === 0) throw new Error("第一个项目的当前页上没有 image 节点（替身模型的首页应当有一张）");
  await slot.click();
  const big = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 2400; c.height = 1800;
    const g = c.getContext("2d"); const d = g.createImageData(2400, 1800);
    for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 2654435761) % 251;
    g.putImageData(d, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("design-inspector-image-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(big, "base64") });
  await phone.locator('[data-proto="image"] img').first().waitFor({ timeout: 30_000 });
  await page.reload();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-view-single").click();
  const img = page.getByTestId("design-detail-phone").locator('[data-proto="image"] img').first();
  await img.waitFor({ timeout: 20_000 });
  const info = await img.evaluate((el) => ({ w: el.naturalWidth, len: el.getAttribute("src")?.length ?? 0 }));
  const s = await shot("s19-real-image.png");
  if (info.w === 0) throw new Error("刷新后 <img> 在，但图没解码出来");
  return { detail: `原图 PNG ${Math.round(big.length / 1024)} KB（base64）→ 存下的 JPEG data URL ${Math.round(info.len / 1024)} KB、宽 ${info.w}px；刷新后仍在（真 API 请求体 + PGlite）`, shot: s };
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
