/**
 * 设计工作台 × Claude Design 对标评测（R0，2026-09-23 冻结）。
 *
 * 十个维度，每维若干条检查；**每条检查都是真浏览器里一个用户看得见的结果**（颜色、位置、文字、
 * 下载下来的文件内容），不是「某个函数存在」。维度得分 = 该维通过条数 / 该维总条数，总分 = 十维之和。
 * 评分表、跑法、每轮结果见 `evidence/design-parity-eval/README.md`；打分脚本 `score.mjs`。
 *
 * 维度的名字与含义只在 `score.mjs` 的 `DIMENSIONS` 里写一次；每条检查的标题以 `[Dx.cy]` 开头归到维度。
 *
 * ⚠ 这里的检查是「目标接口」：基线时有的 testid 还不存在，那一条就失败——那就是差距。
 *   冻结后只允许修评测自身的 bug（在 README 的轮次记录里写明），不允许为了分数放宽检查。
 * ⚠ 本文件**不进 CI 门**（基线本来就大面积失败）。每一轮修掉的差距，另写一条进
 *   `playwright.design-loop.config.ts` 车道的回归 e2e——那才是门。
 */
import { readFileSync } from "node:fs";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../../scripts/lib/design-loop-fixtures.mjs";
import { EVAL_PROJECTS } from "./cases.mjs";
import { routeEvalEditing } from "./eval-api";

test.use({
  launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {},
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

/* ───────────────────────────── helpers ───────────────────────────── */

async function openCase(page: Page, caseId: string): Promise<void> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  const projects = await routeDesignWorkbench(page, { extraProjects: EVAL_PROJECTS });
  await routeEvalEditing(page, projects);
  await page.goto(`/preview/feedback-design-loop?scene=detail-eval&case=${caseId}`);
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-canvas").waitFor();
}

async function openSample(page: Page): Promise<void> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  await routeDesignWorkbench(page, {});
  await page.goto("/preview/feedback-design-loop?scene=detail-prototype");
  await page.getByTestId("design-detail").waitFor();
}

async function single(page: Page, frame = 0): Promise<Locator> {
  await page.getByTestId("design-detail-view-single").click();
  if (frame > 0) await page.getByTestId(`design-detail-frame-${frame}`).click();
  const phone = page.getByTestId("design-detail-phone");
  await expect(phone).toHaveCount(1);
  return phone;
}

async function appearance(page: Page): Promise<void> {
  if (await page.getByTestId("design-detail-appearance-panel").isVisible().catch(() => false)) return;
  await page.getByTestId("design-detail-appearance").click();
  await page.getByTestId("design-detail-appearance-panel").waitFor();
}

const node = (scope: Page | Locator, id: string) => scope.locator(`[data-node-id="${id}"]`).first();

/** 元素实际看得见的背景色：自己透明就往上找。 */
async function effectiveBg(l: Locator): Promise<[number, number, number]> {
  return l.evaluate((el) => {
    let cur: Element | null = el;
    while (cur !== null) {
      const c = getComputedStyle(cur).backgroundColor;
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      if (m !== null && (m[4] === undefined || Number(m[4]) > 0.5)) return [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
      cur = cur.parentElement;
    }
    return [255, 255, 255] as [number, number, number];
  });
}
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const firstFont = (l: Locator) => l.evaluate((el) => getComputedStyle(el).fontFamily.split(",")[0]!.trim().replace(/["']/g, ""));
const radiusPx = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));

async function downloadText(page: Page, trigger: () => Promise<void>): Promise<{ name: string; text: string; bytes: number }> {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), trigger()]);
  const path = await d.path();
  const buf = readFileSync(path);
  return { name: d.suggestedFilename(), text: buf.toString("utf8"), bytes: buf.length };
}

async function exportMenu(page: Page): Promise<void> {
  await page.getByTestId("design-detail-export").click();
  await page.getByTestId("design-detail-export-menu").waitFor();
}

/** 记下发往某个路径的请求体（不拦截，只旁听）。 */
function listen(page: Page, re: RegExp): unknown[] {
  const seen: unknown[] = [];
  page.on("request", (req) => {
    if (re.test(new URL(req.url()).pathname) && req.method() !== "GET") {
      try { seen.push(req.postDataJSON()); } catch { seen.push(req.postData()); }
    }
  });
  return seen;
}

/* ───────────────────────────── D1 视觉定制 ───────────────────────────── */

test.describe("D1 视觉定制", () => {
  test("[D1.c1] 明暗主题：深色原型切到浅色，画布整体变亮", async ({ page }) => {
    await openCase(page, "E09");
    const phone = await single(page);
    const before = luminance(await effectiveBg(phone.getByTestId("design-detail-phone-tree")));
    await appearance(page);
    await page.getByTestId("design-detail-theme-light").click();
    await expect.poll(async () => luminance(await effectiveBg(phone.getByTestId("design-detail-phone-tree")))).toBeGreaterThan(before + 100);
  });

  test("[D1.c2] 强调色落到每一页：换成蓝色后，所有页的主按钮都是同一个蓝", async ({ page }) => {
    await openCase(page, "E09");
    await page.getByTestId("design-detail-view-board").click();
    await appearance(page);
    await page.getByTestId("design-detail-accent-blue").click();
    const ids = ["e09-play", "e09-shuffle"];
    await expect.poll(async () => {
      const bgs = await Promise.all(ids.map((id) => effectiveBg(node(page, id))));
      const [r, g, b] = bgs[0]!;
      return bgs.every((x) => x.join() === bgs[0]!.join()) && b > r + 40 && b > g;
    }).toBe(true);
  });

  test("[D1.c3] 任意品牌色：项目品牌色 #FF5A1F，主按钮就是这个橙", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    await expect.poll(async () => (await effectiveBg(node(phone, "e08-book"))).join()).toBe("255,90,31");
  });

  test("[D1.c4] 在外观里输入品牌色 #1F7AFF：画布立即变色，并写回项目", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    const patches = listen(page, /^\/pm-designs\/eval-E08$/);
    await appearance(page);
    const input = page.getByTestId("design-detail-brand-color");
    await input.fill("#1F7AFF", { timeout: 3000 });
    await input.press("Enter");
    await expect.poll(async () => (await effectiveBg(node(phone, "e08-book"))).join()).toBe("31,122,255");
    await expect.poll(() => JSON.stringify(patches).toUpperCase()).toContain("1F7AFF");
  });

  test("[D1.c5] 字体：项目要衬线体，标题就是衬线体", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    const title = phone.locator('[data-proto="text"]', { hasText: "今晚还有 6 个座位" }).first();
    const font = await firstFont(title);
    expect(font).toMatch(/serif|song|georgia|times/i);
    expect(font).not.toMatch(/sans/i);
  });
});

/* ───────────────────────────── D2 设计系统 ───────────────────────────── */

test.describe("D2 设计系统", () => {
  test("[D2.c1] 圆角一处改：直角 ⇒ 按钮 ≤2px；圆润 ⇒ 按钮 ≥14px", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    await appearance(page);
    await page.getByTestId("design-detail-radius-sharp").click({ timeout: 3000 });
    await expect.poll(() => radiusPx(node(phone, "e08-book"))).toBeLessThanOrEqual(2);
    await page.getByTestId("design-detail-radius-round").click();
    await expect.poll(() => radiusPx(node(phone, "e08-book"))).toBeGreaterThanOrEqual(14);
  });

  test("[D2.c2] 密度一处改：宽松比紧凑的元素间距大", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    const gapOf = () => phone.locator('[data-proto="stack"]').first().evaluate((el) => parseFloat(getComputedStyle(el).rowGap) || 0);
    await appearance(page);
    await page.getByTestId("design-detail-density-compact").click({ timeout: 3000 });
    await page.waitForTimeout(200);
    const compact = await gapOf();
    await page.getByTestId("design-detail-density-comfortable").click();
    await expect.poll(gapOf).toBeGreaterThan(compact + 3);
  });

  test("[D2.c3] 字体一处改：选等宽体，标题跟着变", async ({ page }) => {
    await openCase(page, "E08");
    const phone = await single(page);
    await appearance(page);
    await page.getByTestId("design-detail-font-mono").click({ timeout: 3000 });
    const title = phone.locator('[data-proto="text"]', { hasText: "今晚还有 6 个座位" }).first();
    await expect.poll(() => firstFont(title)).toMatch(/mono|courier|menlo|consolas/i);
  });

  test("[D2.c4] 存得住：改了圆角后刷新，还是改过的样子", async ({ page }) => {
    await openCase(page, "E08");
    await single(page);
    await appearance(page);
    await page.getByTestId("design-detail-radius-sharp").click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.reload();
    await page.getByTestId("design-detail-canvas").waitFor();
    const phone = await single(page);
    await expect.poll(() => radiusPx(node(phone, "e08-book"))).toBeLessThanOrEqual(2);
  });

  test("[D2.c5] 导出跟着走：导出的可点击 HTML 里是品牌色和衬线体", async ({ page }) => {
    await openCase(page, "E08");
    await exportMenu(page);
    const { text } = await downloadText(page, () => page.getByTestId("design-detail-export-html").click());
    expect(text.toLowerCase()).toMatch(/#ff5a1f|255,\s*90,\s*31|16 100% 56/);
    expect(text).toMatch(/serif/i);
    expect(text.replace(/sans-serif/gi, "")).toMatch(/serif/i);
  });
});

/* ───────────────────────────── D3 产出类型 ───────────────────────────── */

test.describe("D3 产出类型", () => {
  test("[D3.c1] 手机 App：三页都画出来了，每页内容充实", async ({ page }) => {
    await openCase(page, "E01");
    await page.getByTestId("design-detail-view-board").click();
    for (let i = 0; i < 3; i += 1) {
      const frame = page.getByTestId(`design-detail-board-frame-${i}`);
      expect(await frame.locator("[data-proto]").count()).toBeGreaterThanOrEqual(6);
    }
    await expect(page.getByTestId("design-detail-canvas-empty")).toHaveCount(0);
  });

  test("[D3.c2] 桌面 Web 应用：桌面尺寸下侧栏在左、主区在右，三个指标同一行", async ({ page }) => {
    await openCase(page, "E03");
    await appearance(page);
    await page.getByTestId("design-detail-device").selectOption("desktop");
    const phone = await single(page);
    const side = await node(phone, "e03-side").boundingBox();
    const main = await phone.locator('[data-proto="stat"]').first().boundingBox();
    expect(side).not.toBeNull(); expect(main).not.toBeNull();
    expect(main!.x).toBeGreaterThanOrEqual(side!.x + side!.width - 1);
    const ys = await phone.locator('[data-proto="stat"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
    expect(ys.length).toBe(3);
    expect(new Set(ys).size).toBe(1);
  });

  test("[D3.c3] 官网落地页：至少三个分区，最后有页脚", async ({ page }) => {
    await openCase(page, "E04");
    const phone = await single(page);
    expect(await phone.locator('[data-proto="section"]').count()).toBeGreaterThanOrEqual(3);
    await expect(phone.locator('[data-proto="footer"]')).toContainText("隐私政策");
  });

  test("[D3.c4] 幻灯片：有 16:9 的幻灯片画布", async ({ page }) => {
    await openCase(page, "E07");
    await appearance(page);
    await page.getByTestId("design-detail-device").selectOption("slide", { timeout: 3000 });
    const phone = await single(page);
    const box = await phone.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeGreaterThan(1.65);
    expect(box!.width / box!.height).toBeLessThan(1.9);
  });
});

/* ───────────────────────────── D4 组件表达力 ───────────────────────────── */

test.describe("D4 组件表达力", () => {
  test("[D4.c1] 表格：四列表头、四行数据", async ({ page }) => {
    await openCase(page, "E03");
    const phone = await single(page);
    const table = phone.locator('[data-proto="table"]');
    await expect(table).toContainText("订单号", { timeout: 3000 });
    await expect(table).toContainText("星海科技");
    expect(await table.locator('[role="columnheader"], th').count()).toBe(4);
    expect(await table.locator('[role="row"], tr').count()).toBeGreaterThanOrEqual(5);
  });

  test("[D4.c2] 带数据的图表：七根柱子，周六最高、周三最低", async ({ page }) => {
    await openCase(page, "E10");
    const phone = await single(page);
    const bars = phone.locator('[data-proto="chart"] [data-bar]');
    await expect(bars).toHaveCount(7, { timeout: 3000 });
    const hs = await bars.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(hs.indexOf(Math.max(...hs))).toBe(5);
    expect(hs.indexOf(Math.min(...hs))).toBe(2);
  });

  test("[D4.c3] 表单：下拉显示当前值，单选组第三项被选中", async ({ page }) => {
    await openCase(page, "E05");
    const phone = await single(page);
    await expect(phone.locator('[data-proto="select"]')).toContainText("上海", { timeout: 3000 });
    const radios = phone.locator('[data-proto="radio"] [role="radio"]');
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(2)).toHaveAttribute("aria-checked", "true");
  });

  test("[D4.c4] 弹窗叠层：确认框盖在页面上，有遮罩", async ({ page }) => {
    await openCase(page, "E06");
    const phone = await single(page, 1);
    const overlay = phone.locator('[data-proto="overlay"]');
    await expect(overlay).toContainText("确定注销账号？", { timeout: 3000 });
    const scrim = await phone.locator("[data-overlay-scrim]").boundingBox();
    const screen = await phone.getByTestId("design-detail-phone-tree").boundingBox();
    expect(scrim).not.toBeNull(); expect(screen).not.toBeNull();
    expect(scrim!.width * scrim!.height).toBeGreaterThan(0.8 * screen!.width * screen!.height);
  });
});

/* ───────────────────────────── D5 生成体验 ───────────────────────────── */

test.describe("D5 生成体验", () => {
  test("[D5.c1] 生成中看得见：秒数在走、可以取消", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-input").fill("输入区加一个附件按钮");
    await page.getByTestId("design-detail-send").click();
    await expect(page.getByTestId("design-detail-generating")).toBeVisible();
    await expect(page.getByTestId("design-detail-elapsed")).toHaveText(/\d+s/);
    await expect(page.getByTestId("design-detail-cancel")).toBeVisible();
  });

  test("[D5.c2] 取消不丢草稿：点取消后刚才那句话还在输入框里", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-input").fill("输入区加一个附件按钮");
    await page.getByTestId("design-detail-send").click();
    await page.getByTestId("design-detail-cancel").click();
    await expect(page.getByTestId("design-detail-input")).toHaveValue("输入区加一个附件按钮");
  });

  test("[D5.c3] 下一步建议：回复后给出可一点即发的建议", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-input").fill("把发送键做大一点");
    await page.getByTestId("design-detail-send").click();
    await expect(page.getByTestId("design-detail-suggestions").locator("button").first()).toBeVisible({ timeout: 10_000 });
  });

  test("[D5.c4] 照着一张图画：有入口且可用", async ({ page }) => {
    await openSample(page);
    await expect(page.getByRole("button", { name: "照着一张图画" })).toBeEnabled();
  });
});

/* ───────────────────────────── D6 直接编辑 ───────────────────────────── */

async function editBuyLabel(page: Page, phone: Locator): Promise<void> {
  await node(phone, "e02-buy").click();
  await page.getByTestId("design-inspector").waitFor();
  await page.getByTestId("design-inspector-label").fill("马上购买");
  await page.getByTestId("design-inspector-apply").click();
  await expect(node(phone, "e02-buy")).toContainText("马上购买");
}

test.describe("D6 直接编辑", () => {
  test("[D6.c1] 属性面板改文案，画布跟着变", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await editBuyLabel(page, phone);
  });

  test("[D6.c2] 撤销：回到改之前", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await editBuyLabel(page, phone);
    await page.getByTestId("design-detail-undo").click();
    await expect(node(phone, "e02-buy")).toContainText("立即购买");
  });

  test("[D6.c3] 重做：撤销之后还能再恢复回来", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await editBuyLabel(page, phone);
    await page.getByTestId("design-detail-undo").click();
    await expect(node(phone, "e02-buy")).toContainText("立即购买");
    await page.getByTestId("design-detail-redo").click({ timeout: 3000 });
    await expect(node(phone, "e02-buy")).toContainText("马上购买");
  });

  test("[D6.c4] 画布上直接改字：双击标题、输入、回车", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    const title = phone.locator('[data-proto="text"]', { hasText: "年度会员 · 专业版" }).first();
    await title.dblclick();
    const editor = phone.locator('[contenteditable="true"], [data-testid="design-canvas-inline-edit"]').first();
    await editor.waitFor({ timeout: 3000 });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("年度会员 · 旗舰版");
    await page.keyboard.press("Enter");
    await expect(phone).toContainText("年度会员 · 旗舰版");
  });

  test("[D6.c5] 图层里拖拽排序：把「同意协议」拖到 tabs 上方", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    const from = page.getByTestId("design-layer-e02-agree");
    const to = page.getByTestId("design-layer-e02-tabs");
    await from.dragTo(to, { timeout: 3000 });
    await expect.poll(async () => {
      const a = await node(phone, "e02-agree").boundingBox();
      const t = await node(phone, "e02-tabs").boundingBox();
      return a !== null && t !== null && a.y < t.y;
    }).toBe(true);
  });
});

/* ───────────────────────────── D7 批注 ───────────────────────────── */

async function comment(page: Page, phone: Locator, id: string, text: string): Promise<void> {
  await node(phone, id).click();
  const input = page.getByTestId("design-comment-input");
  await input.fill(text, { timeout: 3000 });
  await page.getByTestId("design-comment-save").click();
}

test.describe("D7 批注", () => {
  test("[D7.c1] 批注模式：点一个元素写一句，元素上钉一个标记", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-comment").click({ timeout: 3000 });
    await comment(page, phone, "e02-buy", "按钮再醒目一点");
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);
  });

  test("[D7.c2] 批注列表：两条批注都在，写明是哪个元素", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-comment").click({ timeout: 3000 });
    await comment(page, phone, "e02-buy", "按钮再醒目一点");
    await comment(page, phone, "e02-tabs", "评价放第一个");
    const items = page.getByTestId("design-comment-item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText("评价放第一个");
  });

  test("[D7.c3] 一次交给 AI：两条批注合成一次请求，发完标记为已处理", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    const chats = listen(page, /^\/pm-designs\/eval-E02\/chat$/);
    await page.getByTestId("design-detail-mode-comment").click({ timeout: 3000 });
    await comment(page, phone, "e02-buy", "按钮再醒目一点");
    await comment(page, phone, "e02-tabs", "评价放第一个");
    await page.getByTestId("design-comments-send").click();
    await expect.poll(() => chats.length).toBe(1);
    const body = JSON.stringify(chats[0]);
    expect(body).toContain("按钮再醒目一点");
    expect(body).toContain("评价放第一个");
    await expect(phone.locator('[data-testid="design-comment-pin"]:not([data-resolved="true"])')).toHaveCount(0, { timeout: 10_000 });
  });
});

/* ───────────────────────────── D8 变体 ───────────────────────────── */

/** 变体接口的模型替身：给三份各不相同的「商品详情」页（真实接口由产品实现，这里只替模型出稿）。 */
async function routeVariants(page: Page): Promise<unknown[]> {
  const seen: unknown[] = [];
  const variant = (tag: string) => ({
    type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
      { type: "navbar", props: { title: "商品详情", left: "‹" } },
      { type: "text", props: { content: `年度会员 · ${tag}`, variant: "title" } },
      { type: "button", props: { label: "立即购买", variant: "primary", full: true } },
    ],
  });
  await page.route((url) => /^\/pm-designs\/eval-E02\/variants$/.test(url.pathname), async (route) => {
    seen.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      variants: [
        { summary: "方案 A：大图在上", root: variant("方案 A") },
        { summary: "方案 B：价格前置", root: variant("方案 B") },
        { summary: "方案 C：卡片式", root: variant("方案 C") },
      ],
    }) });
  });
  return seen;
}

test.describe("D8 变体", () => {
  test("[D8.c1] 一次出三个方案并排看", async ({ page }) => {
    await openCase(page, "E02");
    await routeVariants(page);
    await single(page);
    await page.getByTestId("design-detail-variants").click({ timeout: 3000 });
    for (const [i, tag] of ["方案 A", "方案 B", "方案 C"].entries()) {
      await expect(page.getByTestId(`design-variant-${i}`)).toContainText(tag);
    }
  });

  test("[D8.c2] 选一个：这一页换成它，候选收起", async ({ page }) => {
    await openCase(page, "E02");
    await routeVariants(page);
    const phone = await single(page);
    await page.getByTestId("design-detail-variants").click({ timeout: 3000 });
    await page.getByTestId("design-variant-pick-1").click();
    await expect(phone).toContainText("年度会员 · 方案 B");
    await expect(page.getByTestId("design-variant-0")).toHaveCount(0);
  });

  test("[D8.c3] 选了能撤销：回到原来的页", async ({ page }) => {
    await openCase(page, "E02");
    await routeVariants(page);
    const phone = await single(page);
    await page.getByTestId("design-detail-variants").click({ timeout: 3000 });
    await page.getByTestId("design-variant-pick-1").click();
    await expect(phone).toContainText("年度会员 · 方案 B");
    await page.getByTestId("design-detail-undo").click();
    await expect(phone).toContainText("年度会员 · 专业版");
  });
});

/* ───────────────────────────── D9 可交互原型 ───────────────────────────── */

test.describe("D9 可交互原型", () => {
  test("[D9.c1] 预览里点底部导航「历史」，换到历史会话页", async ({ page }) => {
    await openCase(page, "E01");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-preview").click();
    await node(phone, "e01-tabs").getByText("历史", { exact: true }).click();
    // R6 修正（评测自身）：「搜索会话」是输入框的占位字。R6 起预览里的输入框是真的 <input>，占位字不在
    // textContent 里——原来按文字找，等于要求输入框必须是一张画出来的图。改成「占位字或文字」都认，意图不变。
    const target = page.getByTestId("design-detail-phone");
    await expect(target.getByPlaceholder("搜索会话").or(target.getByText("搜索会话"))).toBeVisible();
  });

  test("[D9.c2] 预览里 tabs 能切：点「规格」，它变成选中", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-preview").click();
    const tab = node(phone, "e02-tabs").getByRole("tab", { name: "规格" });
    await tab.click({ timeout: 3000 });
    await expect(tab).toHaveAttribute("aria-selected", "true");
  });

  test("[D9.c3] 预览里开关、勾选能点", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-preview").click();
    const sw = node(phone, "e02-auto").getByRole("switch");
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 3000 });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    const cb = node(phone, "e02-agree").getByRole("checkbox");
    await cb.click();
    await expect(cb).toHaveAttribute("aria-checked", "true");
  });

  test("[D9.c4] 预览里能打字：跳到确认订单页，在优惠码里输入", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-mode-preview").click();
    await node(phone, "e02-buy").click();
    const input = node(page.getByTestId("design-detail-phone"), "e02-coupon").locator("input, textarea").first();
    await input.fill("VIP30", { timeout: 3000 });
    await expect(input).toHaveValue("VIP30");
  });
});

/* ───────────────────────────── D10 交付交接 ───────────────────────────── */

test.describe("D10 交付交接", () => {
  test("[D10.c1] 可点击 HTML：三页都在，带跳转脚本", async ({ page }) => {
    await openCase(page, "E01");
    await exportMenu(page);
    const { name, text } = await downloadText(page, () => page.getByTestId("design-detail-export-html").click());
    expect(name).toMatch(/\.html$/);
    for (const f of ["聊天", "历史会话", "设置"]) expect(text).toContain(f);
    expect(text).toContain("<script");
  });

  test("[D10.c2] PDF：打印视图里三页都在", async ({ page }) => {
    await openCase(page, "E01");
    await page.addInitScript(() => { window.print = () => undefined; });
    await exportMenu(page);
    const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 10_000 }), page.getByTestId("design-detail-export-pdf").click()]);
    await popup.waitForLoadState();
    const html = await popup.content();
    for (const f of ["聊天", "历史会话", "设置"]) expect(html).toContain(f);
  });

  test("[D10.c3] 图片与设计文档：PNG 非空、文档里有每一页", async ({ page }) => {
    await openCase(page, "E01");
    await exportMenu(page);
    const png = await downloadText(page, () => page.getByTestId("design-detail-export-png").click());
    expect(png.name).toMatch(/\.png$/);
    expect(png.bytes).toBeGreaterThan(2000);
    await exportMenu(page);
    const doc = await downloadText(page, () => page.getByTestId("design-detail-export-doc").click());
    for (const f of ["聊天", "历史会话", "设置"]) expect(doc.text).toContain(f);
  });

  test("[D10.c4] 分享链接：发布后拿到可复制的链接", async ({ page }) => {
    await openCase(page, "E01");
    await page.getByTestId("design-detail-share").click();
    await page.getByTestId("design-share-publish").click();
    await expect(page.getByTestId("design-share-url")).toHaveValue(/^https?:\/\//);
  });

  test("[D10.c5] 代码交接：导出一份能直接用的前端代码", async ({ page }) => {
    await openCase(page, "E01");
    await exportMenu(page);
    const code = await downloadText(page, () => page.getByTestId("design-detail-export-code").click({ timeout: 3000 }));
    expect(code.name).toMatch(/\.(tsx|jsx|zip)$/);
    expect(code.text).toMatch(/export default function/);
    expect(code.text).toContain("发送");
  });
});
