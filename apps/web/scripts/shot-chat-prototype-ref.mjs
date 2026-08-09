// 抓「对话主屏」的**原型参照图**（reference set），供 chat 主屏保真迭代逐张比对。
//
// 为什么需要它：`ui-preview/chat/` 与 `chat-v2/` 都只覆盖 `/chat/landing` 与
// `/chat/preset` 两屏；`chat-v2/README.md` 逐字写着「`/chat` 主屏（S1）仍零截图」——
// 主屏从来没有做过原型保真，也就没有任何可比对的基准。本脚本把权威原型
// （`phases/requirements/WorkspaceX Standalone.html`，17MB 自包含）里的对话主屏
// 按状态抓成 png，落进 `ui-preview/chat-main-ref/`，作为迭代的**唯一参照**。
//
// ⚠ 这些图是**原型**，不是产品截图。它们不进 `ui-material-map.json`（不是签核材料），
//   只作为保真度比对的输入。产品侧截图由 `shot-chat-main-live.mjs` 抓。
//
// 用法：OUT=<目录> node scripts/shot-chat-prototype-ref.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ⚠ 用 fileURLToPath 而不是 `new URL(...).pathname`：后者返回的是**已百分号编码**的路径，
//   再喂给 pathToFileURL 会把空格二次编码成 `%2520`，表现为 ERR_FILE_NOT_FOUND。
const PROTOTYPE = resolve(
  process.env.PROTOTYPE ??
    fileURLToPath(new URL("../../../phases/requirements/WorkspaceX Standalone.html", import.meta.url)),
);
const OUT = process.env.OUT ?? resolve(
  fileURLToPath(new URL("../../../phases/phase-01-run-a-project/ui-preview/chat-main-ref", import.meta.url)),
);
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };

/**
 * 点一个包含该文本的**最小叶子元素**。
 *
 * ⚠ 不用 `getByText(text, { exact: true })`：原型的标签几乎都带计数后缀
 * （`执行 2/4`、`洞察 6`、`材料 12`），exact 匹配一条都命中不了；而 exact:false
 * 又会把整个祖先链都算命中，`.first()` 常常是半屏大的容器，点上去落在空白处。
 * 所以这里显式取「包含该文本、且面积最小」的可见元素，再按中心点点击。
 */
async function clickText(page, text) {
  const box = await page.evaluate((needle) => {
    const hits = [...document.querySelectorAll("*")]
      .filter((el) => {
        if (!(el.textContent || "").includes(needle)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 120;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { area: r.width * r.height, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })
      .sort((a, b) => a.area - b.area);
    return hits[0] ?? null;
  }, text);
  if (!box) throw new Error(`原型里找不到可点的「${text}」`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(600);
}

/**
 * 底部演示条会入图，抓图前关掉它。
 *
 * ⚠ 必须取**面积最小**的那个匹配元素。第一版用 `.find()` 拿文档序第一个含「组员入口」
 *   的 div —— 那是整个应用的外层容器，`display:none` 把**全屏**隐藏掉了，
 *   脚本照样打印 ✓、产出 9 张纯色空图。这正是本仓反复踩的「全绿但空转」。
 *   下面 `assertNotBlank` 是为同一件事补的反证门。
 */
async function hideDemoBar(page) {
  await page.evaluate(() => {
    const bar = [...document.querySelectorAll("div")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 80 && r.bottom > window.innerHeight - 80
          && (el.innerText || "").includes("组员入口");
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      })[0];
    if (bar) bar.style.visibility = "hidden";
  });
}

/** 截图前的反证门：屏上必须还有对话主屏的内容，否则这一张是空转产物。 */
async function assertNotBlank(page, file) {
  const text = await page.evaluate(() => document.body.innerText.trim());
  if (!text.includes("本线程的 AI 团队")) {
    throw new Error(`${file}: 截图前主屏内容已消失（innerText ${text.length} 字），拒绝产出空图`);
  }
}

async function open(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(pathToFileURL(PROTOTYPE).href, { waitUntil: "load", timeout: 180_000 });
  // 原型是一个自渲染的 bundle：等到对话主屏的固定文案出现为止，不用 sleep 猜。
  await page.getByText("本线程的 AI 团队", { exact: false }).first().waitFor({ timeout: 60_000 });
  await hideDemoBar(page);
  return page;
}

/** [文件名, 视口, 交互] */
const SHOTS = [
  ["chat-main-default.png", DESKTOP, null],
  ["chat-main-side-exec.png", DESKTOP, (p) => clickText(p, "执行")],
  ["chat-main-side-insight.png", DESKTOP, (p) => clickText(p, "洞察")],
  ["chat-main-side-artifact.png", DESKTOP, (p) => clickText(p, "产物")],
  ["chat-main-side-material.png", DESKTOP, (p) => clickText(p, "材料")],
  ["chat-main-team.png", DESKTOP, (p) => clickText(p, "编辑")],
  ["chat-main-composer-more.png", DESKTOP, (p) => clickText(p, "更多设置")],
  ["chat-main-new-thread.png", DESKTOP, (p) => clickText(p, "新建对话")],
  ["chat-main-mobile.png", MOBILE, null],
];

const browser = await chromium.launch();
let shot = 0;
for (const [file, viewport, interact] of SHOTS) {
  const page = await open(browser, viewport);
  try {
    if (interact) await interact(page);
  } catch (error) {
    console.error(`✗ ${file}: 交互失败 —— ${error.message}`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(400);
  await assertNotBlank(page, file);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`✓ ${file}`);
  await page.close();
  shot += 1;
}
await browser.close();
if (shot < SHOTS.length) {
  console.error(`✗ 只产出 ${shot}/${SHOTS.length} 张参照图`);
  process.exit(1);
}
