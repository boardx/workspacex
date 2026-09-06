import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";

/**
 * UC-17.8 B6.5 —— 研发闭环四屏（草稿 / 收件箱看板 / PM 设计工作台 / 设计详情）在
 * 375 / 768 / 1280 三档视口**不横向溢出**（uiux-standards U8）。
 *
 * ## 为什么另起一条 spec 而不是往 `responsive.spec.ts` 加四条路径
 * 这四屏是真栈屏，进屏就打 `/feedback/drafts*`、`/inbox*`、`/pm-designs*`；`responsive.spec.ts`
 * 走的是不需要后端的静态/取材路径。这里对取材页 `/preview/feedback-design-loop` 用
 * `page.route()` 夹具（与截图脚本 `scripts/shot-feedback-design-loop.mjs` **同一份**，
 * `scripts/lib/design-loop-fixtures.mjs`）供数据，因此**不需要 API/DB**，可以挂在
 * `playwright.fullstack-smoke.config.ts` 的无依赖 project 里（同 `axe-keyboard-focus`），
 * 只复用起好的 web 服务器。
 *
 * ## 断言口径与 `responsive.spec.ts` 第三版一致
 * 文档级 `scrollWidth` 不超视口；且任何会裁（hidden/clip）或需滚（auto/scroll）的容器都
 * 不许 `scrollWidth > clientWidth`——除非它显式声明 `data-allow-x-scroll="理由"`（看板四列在
 * 窄视口下横向滚动、列表视图的宽表格，都是**写出来的**设计，不是从 computed style 猜的）。
 * 判定逻辑抄自 `responsive.spec.ts`，两处都写明「若改口径请同步」——它们量的是同一条标准 U8。
 */

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 800 },
] as const;

/** 四屏 × 各自的主要叠层：drawer/浮层在 375 下最容易把宽度撑出去，所以也一起量。 */
const SCENES: { name: string; scene: string; ready: string; prepare?: (page: Page) => Promise<void> }[] = [
  { name: "drafts", scene: "drafts", ready: '[data-testid="drafts-list"]' },
  {
    name: "drafts + 编辑 drawer", scene: "drafts", ready: '[data-testid="drafts-list"]',
    prepare: (p) => clickUntil(p, '[data-testid^="draft-open-"]', '[data-testid="draft-edit-drawer"]'),
  },
  {
    name: "drafts + 继续完善浮层", scene: "drafts", ready: '[data-testid="drafts-list"]',
    prepare: (p) => clickUntil(p, '[data-testid^="draft-refine-"]', '[data-testid="draft-refine-overlay"]'),
  },
  { name: "inbox 看板", scene: "inbox-board", ready: '[data-testid="inbox-board"]' },
  {
    name: "inbox 看板 + drawer", scene: "inbox-board", ready: '[data-testid="inbox-board"]',
    prepare: (p) => clickUntil(p, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]'),
  },
  {
    name: "inbox 列表", scene: "inbox-board", ready: '[data-testid="inbox-board"]',
    prepare: (p) => clickUntil(p, '[data-testid="inbox-view-list"]', '[data-testid="inbox-list"]'),
  },
  { name: "workbench", scene: "workbench", ready: '[data-testid="workbench-grid"]' },
  {
    name: "workbench + 新建弹窗", scene: "workbench", ready: '[data-testid="workbench-grid"]',
    prepare: (p) => clickUntil(p, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]'),
  },
  { name: "detail 画布", scene: "detail", ready: '[data-testid="design-detail-canvas"]' },
  {
    name: "detail 说明", scene: "detail", ready: '[data-testid="design-detail-canvas"]',
    prepare: (p) => clickUntil(p, '[data-testid="design-detail-tab-spec"]', '[data-testid="design-detail-spec"]'),
  },
  // 迭代 10：原型画布——画板视图（自身可平移，标 data-allow-x-scroll）与单页 + 属性面板 + 历史
  { name: "detail 原型画板", scene: "detail-prototype", ready: '[data-testid="design-detail-board"]' },
  {
    name: "detail 原型单页 + 属性面板 + 历史", scene: "detail-prototype", ready: '[data-testid="design-detail-board"]',
    prepare: async (p) => {
      await clickUntil(p, '[data-testid="design-detail-view-single"]', '[data-testid="design-detail-phone-tree"]');
      await clickUntil(p, '[data-proto="button"]', '[data-testid="design-inspector"]');
      await clickUntil(p, '[data-testid="design-detail-history-toggle"]', '[data-testid="design-history"]');
    },
  },
];

async function clickUntil(page: Page, selector: string, expected: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    if ((await page.locator(expected).count()) > 0) return;
    await page.locator(selector).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
  throw new Error(`clickUntil: ${expected} never appeared after clicking ${selector}`);
}

/** 与 `responsive.spec.ts` 同口径（改一处请同步另一处）。 */
async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const docOverflow = doc.scrollWidth - window.innerWidth;
    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (cs.overflowX === "visible") continue;
      if (el.closest("[data-allow-x-scroll]")) continue;
      if (el.classList.contains("sr-only")) continue;
      if (el.clientWidth <= 1 && el.clientHeight <= 1) continue;
      if (cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap") continue;
      const over = el.scrollWidth - el.clientWidth;
      if (over <= 1) continue;
      const cls = (el.className || "").toString().slice(0, 70);
      const tid = el.getAttribute("data-testid");
      clipped.push(
        `${el.tagName}${tid ? `[${tid}]` : `.${cls}`} → 超出 ${over}px（scrollW=${el.scrollWidth} clientW=${el.clientWidth} overflow-x=${cs.overflowX}）`,
      );
      if (clipped.length >= 5) break;
    }
    return { docOverflow, vw: window.innerWidth, scrollW: doc.scrollWidth, clipped };
  });
}

// 本地沙箱的 chromium 版本可能与 @playwright/test 期望的不一致：同截图脚本的 `PW_EXECUTABLE` 约定，
// 给了就用它启动；CI 里不设，走 Playwright 自装的浏览器。
test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {} });

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name}（${vp.width}px）`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const s of SCENES) {
      test(`${s.name} 无横向溢出`, async ({ page }) => {
        await routeDrafts(page, { empty: false });
        await routeInbox(page, { empty: false });
        await routeDesignWorkbench(page);
        await page.goto(`/preview/feedback-design-loop?scene=${s.scene}&state=default`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(s.ready, { timeout: 30_000 });
        if (s.prepare) await s.prepare(page);
        await page.waitForTimeout(300);

        const result = await measureOverflow(page);
        expect(result.docOverflow, `页面产生了横向滚动 ${result.docOverflow}px（视口 ${result.vw}，文档 ${result.scrollW}）`).toBeLessThanOrEqual(1);
        expect(
          result.clipped,
          result.clipped.length
            ? `有内容横向超出容器（被裁掉、或需要横向滚动才能看全）：\n  ${result.clipped.join("\n  ")}\n若该处横向滚动确实是设计，请在该元素加 data-allow-x-scroll="理由"。`
            : "",
        ).toEqual([]);
      });
    }
  });
}
