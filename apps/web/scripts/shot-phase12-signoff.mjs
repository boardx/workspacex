// 截图生成器 —— phase-12-uiux-foundation 四个契约束的签核①材料。
//
// 三类来源，各取最忠实的**离线**可渲染面（都不依赖后端栈）：
//   1. /kitchen-sink       —— 本轮新增的真实组件（Dialog/Dropdown/Select/Tooltip + 动效 token 档位）
//   2. /profile/preview    —— 真实 ProfileScreen 组件 + PreviewSessionProvider（mock 身份，零网络）
//   3. /org-admin/preview  —— 真实 OrgAdminApp 组件 + mock 数据（成员列表 + 邀请/角色弹层）
//   4. WorkspaceX Standalone.html —— 对话主屏的**权威原型**（已确认设计语言；线上 /chat 未登录会跳
//      /login，需后端栈，故对话面的「落点参考态」取自这份权威原型，与 shot-chat-prototype-ref.mjs 同源）
//
// 用法：BASE=http://localhost:3199 node scripts/shot-phase12-signoff.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3199";
const PHASE = resolve(fileURLToPath(new URL("../../../phases/phase-12-uiux-foundation", import.meta.url)));
const DIR = {
  ip: `${PHASE}/ui-preview/interaction-primitives`,
  motion: `${PHASE}/ui-preview/motion-microinteraction`,
  a11y: `${PHASE}/ui-preview/accessibility-guardrails`,
  review: `${PHASE}/ui-preview/review-governance`,
};
for (const d of Object.values(DIR)) mkdirSync(d, { recursive: true });

const PROTOTYPE = resolve(fileURLToPath(new URL("../../../phases/requirements/WorkspaceX Standalone.html", import.meta.url)));
const VIEWPORT = { width: 1440, height: 960 };

async function gotoReady(page, url, rootSel, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (resp && resp.status() >= 500) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(rootSel, { state: "visible", timeout: 8000 });
      return;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${rootSel} never rendered for ${url}`);
}

async function assertNotBlank(page, label) {
  const len = (await page.evaluate(() => document.body.innerText.trim().length)) ?? 0;
  if (len < 40) throw new Error(`${label}: 屏上内容过少（${len} 字），拒绝产出空图`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
let n = 0;
const save = async (dir, file, opts = {}) => {
  await assertNotBlank(page, file);
  await page.screenshot({ path: `${dir}/${file}`, ...opts });
  n += 1;
  process.stdout.write(`  ✓ ${file}\n`);
};

/* ── 1. interaction-primitives（/kitchen-sink，F01/F02）──────────────────── */
async function shootPrimitives() {
  await gotoReady(page, `${BASE}/kitchen-sink`, '[data-testid="section-primitives"]');
  await page.locator('[data-testid="section-primitives"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  // 默认态：四个原语并排（触发器都在静止态）
  await page.locator('[data-testid="section-primitives"]').screenshot({ path: `${DIR.ip}/f01-f02-primitives-default.png` });
  n += 1; process.stdout.write("  ✓ f01-f02-primitives-default.png\n");

  // Dialog 打开态
  await page.locator('[data-testid="primitive-dialog-trigger"]').click();
  await page.waitForSelector('[data-testid="primitive-dialog-content"]', { state: "visible" });
  await page.waitForTimeout(300);
  await save(DIR.ip, "f01-dialog-open.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Dropdown 展开态 + 键盘高亮
  await page.locator('[data-testid="primitive-dropdown-trigger"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="primitive-dropdown-trigger"]').click();
  await page.waitForSelector('[data-testid="primitive-dropdown-content"]', { state: "visible" });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await save(DIR.ip, "f01-dropdown-open.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Select 键盘导航态
  await page.locator('[data-testid="primitive-select-trigger"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="primitive-select-trigger"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await save(DIR.ip, "f02-select-keyboard-nav.png");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Tooltip 触发态（键盘 focus 触发，与 hover 等价）
  await page.locator('[data-testid="primitive-tooltip-trigger"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="primitive-tooltip-trigger"]').focus();
  await page.waitForSelector('[data-testid="primitive-tooltip-content"]', { state: "visible" });
  await page.waitForTimeout(300);
  await save(DIR.ip, "f02-tooltip-focus.png");
}

/* ── 2. motion-microinteraction（/kitchen-sink 动效档位 + 对话面落点，F03/F04）── */
async function shootMotion() {
  await gotoReady(page, `${BASE}/kitchen-sink`, '[data-testid="section-motion"]');
  await page.locator('[data-testid="section-motion"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="section-motion"]').screenshot({ path: `${DIR.motion}/f03-motion-tokens-rest.png` });
  n += 1; process.stdout.write("  ✓ f03-motion-tokens-rest.png\n");
  // hover 中档，感受 200ms 位移/阴影
  await page.locator('[data-testid="motion-tier-base"]').hover();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="section-motion"]').screenshot({ path: `${DIR.motion}/f03-motion-tokens-hover.png` });
  n += 1; process.stdout.write("  ✓ f03-motion-tokens-hover.png\n");
}

/* ── 3+4. 对话主屏（权威原型）——motion 落点 / a11y composer / review 主屏 ────── */
async function openPrototype() {
  await page.goto(pathToFileURL(PROTOTYPE).href, { waitUntil: "load", timeout: 180_000 });
  await page.getByText("本线程的 AI 团队", { exact: false }).first().waitFor({ timeout: 60_000 });
  // 关掉底部演示条（同 shot-chat-prototype-ref.mjs）
  await page.evaluate(() => {
    const bar = [...document.querySelectorAll("div")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 80 && r.bottom > window.innerHeight - 80 && (el.innerText || "").includes("组员入口");
      })
      .sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; })[0];
    if (bar) bar.style.visibility = "hidden";
  });
  await page.waitForTimeout(400);
}
async function clickText(text) {
  const box = await page.evaluate((needle) => {
    const hits = [...document.querySelectorAll("*")]
      .filter((el) => { if (!(el.textContent || "").includes(needle)) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 120; })
      .map((el) => { const r = el.getBoundingClientRect(); return { area: r.width * r.height, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })
      .sort((a, b) => a.area - b.area);
    return hits[0] ?? null;
  }, text);
  if (!box) throw new Error(`原型里找不到可点的「${text}」`);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(600);
}
async function shootChatFromPrototype() {
  await openPrototype();
  // motion: 消息列表默认落点
  await save(DIR.motion, "f04-chat-message-list-default.png");
  // review: 对话主屏整体布局
  await save(DIR.review, "uc-review-chat-main-default.png");
  // a11y: 消息输入区 + 会话列表默认态（同一主屏，composer 与左栏线程列表均在图内）
  await save(DIR.a11y, "uc-a11y-chat-composer-thread-default.png");
  // motion: 面板展开落点（点右侧「执行」段，展开过程区）
  await openPrototype();
  try { await clickText("执行"); } catch { /* 落点参考，展开失败则回退默认主屏 */ }
  await save(DIR.motion, "f04-chat-panel-expanded-default.png");
}

/* ── 3. profile 资料编辑表单（/profile/preview）───────────────────────────── */
async function shootProfile() {
  await gotoReady(page, `${BASE}/profile/preview`, '[data-testid="profile-name-form"]');
  await page.waitForTimeout(500);
  await save(DIR.a11y, "uc-a11y-profile-form-default.png", { fullPage: true });
  await save(DIR.review, "uc-review-profile-default.png", { fullPage: true });
}

/* ── 3+4. org-admin 成员列表 + 权限弹层（/org-admin/preview）──────────────── */
async function shootOrgAdmin() {
  // review: 整体布局（默认落地屏）
  await gotoReady(page, `${BASE}/org-admin/preview`, '[data-testid="app-shell"]');
  await page.waitForTimeout(600);
  await save(DIR.review, "uc-review-orgadmin-default.png");
  // 成员与配额屏（成员列表）
  // ?org=org-local 让 mockIdentity 的 orgRole=admin（组织级 org 只给 consultant，邀请按钮会被禁用）
  await gotoReady(page, `${BASE}/org-admin/preview?screen=members&org=org-local`, '[data-testid="members-invite-open"]');
  await page.waitForTimeout(600);
  await save(DIR.a11y, "uc-a11y-orgadmin-members-default.png");
  // 打开邀请弹层（含组织角色 = 权限设置）。点两次兜底（首次点击偶发未落到 React handler）。
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-testid="members-invite-open"]').click();
    try { await page.waitForSelector('[data-testid="members-invite-dialog"]', { state: "visible", timeout: 4000 }); break; }
    catch { await page.waitForTimeout(400); }
  }
  await page.waitForSelector('[data-testid="members-invite-role"]', { state: "visible", timeout: 8000 });
  await page.waitForTimeout(400);
  await save(DIR.a11y, "uc-a11y-orgadmin-permission-dialog-default.png");
}

try {
  await shootPrimitives();
  await shootMotion();
  await shootProfile();
  await shootOrgAdmin();
  await shootChatFromPrototype();
} finally {
  await browser.close();
}
console.log(`done: ${n} screenshots`);
