/**
 * 对标评测（#3933）每一轮修掉的差距在这里落一条**回归门**——`e2e/parity-eval/` 是出分的尺子
 * （基线大面积失败、不进 CI），这一份才是门：每轮的行为在真浏览器里被钉住，之后谁把它弄坏谁红。
 *
 * 数据同 `design-prototype-loop.spec.ts`：`page.route` 夹具（`scripts/lib/design-loop-fixtures.mjs`）。
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";
// 撤销 / 重做要真的版本日志：用评测那份按真实契约应用 patch、带恢复的替身（只接管 eval-* 项目）。
import { routeEvalEditing } from "./parity-eval/eval-api";
import { newCommentStore, routeEvalComments } from "./parity-eval/depth-api";

test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}, acceptDownloads: true });

async function openSample(page: Page): Promise<void> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  await routeDesignWorkbench(page, {});
  await page.goto("/preview/feedback-design-loop?scene=detail-prototype");
  await page.getByTestId("design-detail").waitFor();
}

async function appearance(page: Page): Promise<void> {
  if (await page.getByTestId("design-detail-appearance-panel").isVisible().catch(() => false)) return;
  await page.getByTestId("design-detail-appearance").click();
  await page.getByTestId("design-detail-appearance-panel").waitFor();
}

/** 样本第 2 页「历史会话」底部的「开始新对话」是主按钮（第 1 页的是危险色的「停止」）。 */
const primaryButtonBg = (page: Page) =>
  page.getByTestId("design-detail-phone").locator('[data-node-id="history-new"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("R1 品牌色与字体（#3933）", () => {
  test("输入品牌色 ⇒ 主按钮就是这个色；选衬线体 ⇒ 标题是衬线；刷新后都还在；导出的 HTML 跟着走", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await appearance(page);
    const input = page.getByTestId("design-detail-brand-color");
    // 打到一半：不刷画布，给人话提示。
    await input.fill("#FF5A");
    await input.press("Enter");
    await expect(page.getByTestId("design-detail-brand-invalid")).toBeVisible();
    await input.fill("#FF5A1F");
    await input.press("Enter");
    await expect.poll(() => primaryButtonBg(page)).toBe("rgb(255, 90, 31)");

    await page.getByTestId("design-detail-font-serif").click();
    const title = page.getByTestId("design-detail-phone").locator('[data-proto="text"]').first();
    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Noto Serif SC/);

    // 刷新：夹具与真实 API 同语义（tokens 按键合并落库），重新读回来仍是品牌色 + 衬线体。
    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await expect.poll(() => primaryButtonBg(page)).toBe("rgb(255, 90, 31)");
    await expect(page.getByTestId("design-detail-phone")).toHaveAttribute("data-font", "serif");

    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-html").click()]);
    const html = readFileSync(await d.path(), "utf8");
    expect(html).toContain("Noto Serif SC");
    expect(html).toContain(`--primary:${(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="design-detail-phone"]')!).getPropertyValue("--primary").trim()))}`);
  });
});

test.describe("R2 圆角与密度（#3933）", () => {
  test("直角 ⇒ 按钮 0 圆角；圆润 ⇒ ≥14px；宽松比紧凑间距大；刷新后还在", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    const btn = page.getByTestId("design-detail-phone").locator('[data-node-id="history-new"]');
    const radius = () => btn.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    const rootGap = () => page.getByTestId("design-detail-phone").locator('[data-proto="stack"]').first()
      .evaluate((el) => parseFloat(getComputedStyle(el).rowGap) || 0);
    await appearance(page);
    await page.getByTestId("design-detail-radius-sharp").click();
    await expect.poll(radius).toBe(0);
    await page.getByTestId("design-detail-radius-round").click();
    await expect.poll(radius).toBeGreaterThanOrEqual(14);
    await page.getByTestId("design-detail-density-compact").click();
    await expect.poll(rootGap).toBeLessThanOrEqual(2);
    await page.getByTestId("design-detail-density-comfortable").click();
    await expect.poll(rootGap).toBeGreaterThanOrEqual(8);

    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await expect.poll(radius).toBeGreaterThanOrEqual(14);
    await expect.poll(rootGap).toBeGreaterThanOrEqual(8);
  });
});

/** 对标 R3：一个带表格与柱状图的看板项目（走取材页的 `detail-eval` 场景，id 前缀 `eval-`）。 */
const R3_PROJECT = {
  id: "eval-R3", name: "周报看板", template: "mobile", problem: "", criteria: [], frames: ["周报"], frameNotes: [""],
  prototype: [{
    id: "r3-root", type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
      { id: "r3-chart", type: "chart", props: { kind: "bar", title: "每日运动", labels: ["一", "二", "三"], values: [30, 90, 45], unit: "分钟" } },
      { id: "r3-table", type: "table", props: { columns: ["日期", "时长"], rows: [["周一", "30"], ["周二", "90"]] } },
    ],
  }],
  pushed: false, pushedAt: null, linkedFeedbackId: null, chat: [], theme: "light", accent: "neutral", tags: [], refImages: [], share: null,
  githubIssueUrl: null, githubIssueNumber: null, ownerId: "u-pm-1", ownerName: "PM", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
};

test.describe("R3 表格与图表（#3933）", () => {
  test("柱高按数据画；属性面板改数值 ⇒ 柱子重画；表格表头与行都在", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R3_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R3");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    const phone = page.getByTestId("design-detail-phone");
    const heights = () => phone.locator("[data-bar]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    await expect(phone.locator("[data-bar]")).toHaveCount(3);
    const [a, b, c] = await heights();
    expect(b).toBeGreaterThan(c!);
    expect(c).toBeGreaterThan(a!);
    await expect(phone.locator('[data-proto="table"] th')).toHaveText(["日期", "时长"]);
    await expect(phone.locator('[data-proto="table"] tbody tr')).toHaveCount(2);

    // 改数据：第一天变成最高。
    await phone.locator('[data-node-id="r3-chart"]').click();
    await page.getByTestId("design-inspector").waitFor();
    await page.getByTestId("design-inspector-values").fill("120\n90\n45");
    await page.getByTestId("design-inspector-apply").click();
    await expect.poll(async () => { const h = await heights(); return h[0]! > h[1]!; }).toBe(true);
  });
});

const R4_PROJECT = {
  ...R3_PROJECT, id: "eval-R4", name: "账号设置", frames: ["设置", "注销确认"], frameNotes: ["", ""],
  prototype: [
    { id: "r4-root", type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
      { id: "r4-city", type: "select", props: { label: "所在城市", options: ["北京", "上海"], value: "上海" } },
      { id: "r4-gender", type: "radio", props: { label: "性别", options: ["男", "女", "不透露"], selected: 2 } },
      { id: "r4-delete", type: "button", props: { label: "注销账号", variant: "danger", full: true } },
    ] },
    { id: "r4-root2", type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
      { id: "r4-list", type: "list", props: { items: ["个人资料", "账号安全"] } },
      { id: "r4-modal", type: "overlay", props: { kind: "modal", title: "确定注销账号？" }, children: [
        { id: "r4-cancel", type: "button", props: { label: "再想想", variant: "secondary" } },
      ] },
    ] },
  ],
};

test.describe("R4 下拉、单选、叠层（#3933）", () => {
  test("下拉显示当前值、单选第三项选中；第二页的弹窗盖满整屏并带遮罩", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R4_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R4");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    const phone = page.getByTestId("design-detail-phone");
    await expect(phone.locator('[data-proto="select"]')).toContainText("上海");
    await expect(phone.getByRole("radio").nth(2)).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("design-detail-frame-1").click();
    const dialog = page.getByTestId("design-detail-phone").getByRole("dialog");
    await expect(dialog).toContainText("确定注销账号？");
    const scrim = await page.getByTestId("design-detail-phone").locator("[data-overlay-scrim]").boundingBox();
    const screenBox = await page.getByTestId("design-detail-phone-tree").boundingBox();
    expect(scrim!.width * scrim!.height).toBeGreaterThan(0.95 * screenBox!.width * screenBox!.height);
  });
});

const R5_PROJECT = {
  ...R3_PROJECT, id: "eval-R5", name: "轻账官网", template: "ui", frames: ["首页"], frameNotes: [""],
  prototype: [{ id: "r5-root", type: "stack", props: { direction: "column", padding: "none", gap: "none" }, children: [
    { id: "r5-hero", type: "section", props: { tone: "primary", align: "center" }, children: [{ id: "r5-h", type: "hero", props: { title: "五分钟搞定一个月的账", cta: "免费试用" } }] },
    { id: "r5-feat", type: "section", props: { tone: "default" }, children: [{ id: "r5-t", type: "text", props: { content: "为什么选轻账", variant: "title" } }] },
    { id: "r5-price", type: "section", props: { tone: "muted" }, children: [{ id: "r5-p", type: "button", props: { label: "开始使用" } }] },
    { id: "r5-foot", type: "footer", props: { brand: "轻账", links: ["产品", "隐私政策"], note: "© 2026 轻账科技" } },
  ] }],
};

test.describe("R5 落地页与幻灯片（#3933）", () => {
  test("桌面尺寸下三个通栏分区 + 页脚；主色区里的按钮是反色；切到幻灯片是 16:9 且内容放大", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R5_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R5");
    await page.getByTestId("design-detail").waitFor();
    await appearance(page);
    await page.getByTestId("design-detail-device").selectOption("desktop");
    await page.getByTestId("design-detail-view-single").click();
    const phone = page.getByTestId("design-detail-phone");
    await expect(phone.locator('[data-proto="section"]')).toHaveCount(3);
    await expect(phone.locator('[data-proto="footer"]')).toContainText("隐私政策");
    // 分区通栏：与内容区等宽。
    const band = await phone.locator('[data-proto="section"]').first().boundingBox();
    const tree = await page.getByTestId("design-detail-phone-tree").boundingBox();
    expect(band!.width).toBeGreaterThan(tree!.width - 20);
    // 主色区里的头图按钮与区底色不同（没有融成一片）。
    const [cta, bg] = await Promise.all([
      phone.locator("[data-hero-cta]").evaluate((e) => getComputedStyle(e).backgroundColor),
      phone.locator('[data-tone="primary"]').evaluate((e) => getComputedStyle(e).backgroundColor),
    ]);
    expect(cta).not.toBe(bg);

    await appearance(page);
    await page.getByTestId("design-detail-device").selectOption("slide");
    const box = await page.getByTestId("design-detail-phone").boundingBox();
    expect(box!.width / box!.height).toBeGreaterThan(1.7);
    expect(box!.width / box!.height).toBeLessThan(1.85);
    await expect(page.getByTestId("design-detail-phone-tree")).toHaveAttribute("data-slide-scale", "2");
  });
});

test.describe("R6 预览里控件是活的（#3933）", () => {
  test("预览：tabs 切换、开关拨动、输入框打字；切回编辑后点控件 = 选中节点", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await page.getByTestId("design-detail-mode-preview").click();
    const phone = page.getByTestId("design-detail-phone");
    // 样本第 2 页「历史会话」：tabs「全部 / 已收藏」、搜索框。
    const fav = phone.getByRole("tab", { name: "已收藏" });
    await fav.click();
    await expect(fav).toHaveAttribute("aria-selected", "true");
    const search = phone.getByPlaceholder("搜索会话");
    await search.fill("退款");
    await expect(search).toHaveValue("退款");

    await page.getByTestId("design-detail-mode-edit").click();
    await expect(phone.getByRole("tab")).toHaveCount(0);
    await phone.getByText("已收藏", { exact: true }).click();
    await expect(page.getByTestId("design-inspector")).toBeVisible();
  });
});

const R7_PROJECT = {
  ...R3_PROJECT, id: "eval-R7", name: "会员下单", frames: ["商品详情"], frameNotes: [""],
  prototype: [{ id: "r7-root", type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
    { id: "r7-title", type: "text", props: { content: "年度会员 · 专业版", variant: "title" } },
    { id: "r7-tabs", type: "tabs", props: { items: ["详情", "规格"] } },
    { id: "r7-agree", type: "checkbox", props: { label: "我已阅读并同意会员协议" } },
  ] }],
};

test.describe("R7 直接编辑（#3933）", () => {
  test("画布上双击改字 → 撤销 → 重做；图层里把勾选拖到 tabs 上方", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    const projects = await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await routeEvalEditing(page, projects);
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    const phone = page.getByTestId("design-detail-phone");

    await phone.getByText("年度会员 · 专业版").dblclick();
    await phone.getByTestId("design-canvas-inline-edit").waitFor();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("年度会员 · 旗舰版");
    await page.keyboard.press("Enter");
    await expect(phone).toContainText("年度会员 · 旗舰版");

    await expect(page.getByTestId("design-detail-redo")).toBeDisabled();
    await page.getByTestId("design-detail-undo").click();
    await expect(phone).toContainText("年度会员 · 专业版");
    await page.getByTestId("design-detail-redo").click();
    await expect(phone).toContainText("年度会员 · 旗舰版");

    await page.getByTestId("design-layer-r7-agree").dragTo(page.getByTestId("design-layer-r7-tabs"));
    await expect.poll(async () => {
      const a = await phone.locator('[data-node-id="r7-agree"]').boundingBox();
      const t = await phone.locator('[data-node-id="r7-tabs"]').boundingBox();
      return a !== null && t !== null && a.y < t.y;
    }).toBe(true);
  });
});

test.describe("R8 批注（#3933）", () => {
  test("批注模式：两个元素各钉一句 ⇒ 画布上两个钉、列表两条；一次交给 AI ⇒ 一次对话请求带两条，钉消失", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-mode-comment").click();
    const phone = page.getByTestId("design-detail-phone");
    const chats: unknown[] = [];
    page.on("request", (r) => { if (/\/pm-designs\/eval-R7\/chat$/.test(new URL(r.url()).pathname)) chats.push(r.postDataJSON()); });
    for (const [id, t] of [["r7-title", "标题换成更口语的说法"], ["r7-agree", "协议勾选默认不勾"]] as const) {
      await phone.locator(`[data-node-id="${id}"]`).click();
      await page.getByTestId("design-comment-input").fill(t);
      await page.getByTestId("design-comment-save").click();
    }
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(2);
    await expect(page.getByTestId("design-comment-item")).toHaveCount(2);
    await page.getByTestId("design-comments-send").click();
    await expect.poll(() => chats.length).toBe(1);
    const body = JSON.stringify(chats[0]);
    expect(body).toContain("标题换成更口语的说法");
    expect(body).toContain("r7-agree");
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(0);
  });
});

test.describe("R9 变体（#3954）", () => {
  test("出三个方案并排 ⇒ 请求带着当前页序号；挑第二个 ⇒ 这一页换成它、候选收起；撤销 ⇒ 回到原来那页", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    const projects = await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await routeEvalEditing(page, projects);
    const asked: unknown[] = [];
    const variant = (tag: string) => ({ type: "stack", children: [{ type: "text", props: { content: `会员 · ${tag}`, variant: "title" } }] });
    await page.route((url) => /^\/pm-designs\/eval-R7\/variants$/.test(url.pathname), async (route) => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        variants: ["甲", "乙", "丙"].map((t) => ({ summary: `方案${t}`, root: variant(`方案${t}`) })),
      }) });
    });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    const phone = page.getByTestId("design-detail-phone");

    await page.getByTestId("design-detail-variants").click();
    for (const [i, t] of ["甲", "乙", "丙"].entries()) await expect(page.getByTestId(`design-variant-${i}`)).toContainText(`会员 · 方案${t}`);
    expect(asked).toEqual([{ screen: 0 }]);

    await page.getByTestId("design-variant-pick-1").click();
    await expect(phone).toContainText("会员 · 方案乙");
    await expect(page.getByTestId("design-variants")).toHaveCount(0);

    await page.getByTestId("design-detail-undo").click();
    await expect(phone).toContainText("年度会员 · 专业版");
  });

  test("接口 503 ⇒ 说没能出方案、可以再试，页面不变", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await page.route((url) => /^\/pm-designs\/eval-R7\/variants$/.test(url.pathname), (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ reasonCode: "DEPENDENCY_UNAVAILABLE" }) }));
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-variants").click();
    await expect(page.getByTestId("design-variants").getByRole("alert")).toContainText("没能出方案");
    await expect(page.getByTestId("design-variant-0")).toHaveCount(0);
  });
});

test.describe("R10 代码交接（#3955）", () => {
  test("导出 React 组件：一个 .tsx、只 import react、默认导出；文案与页面切换都在", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-code").click()]);
    expect(d.suggestedFilename()).toMatch(/^[\x20-\x7e]+\.tsx$/);
    const tsx = readFileSync(await d.path(), "utf8");
    expect(tsx).toMatch(/export default function Prototype\(\)/);
    expect([...tsx.matchAll(/^import\b[^"]*"([^"]+)";$/gm)].map((m) => m[1])).toEqual(["react"]);
    expect(tsx).toContain(`{"年度会员 · 专业版"}`);
    expect(tsx).toContain(`{ name: "商品详情", Component: Screen1 }`);
  });
});

test.describe("深度 S2 批注存在服务端（#3988）", () => {
  test("A 浏览器钉一条 ⇒ 服务端收到；B 浏览器（空存储）打开同一个项目看得到它和它的钉；A 标记交给 AI ⇒ B 刷新后是已解决", async ({ page, browser }) => {
    const store = newCommentStore();
    const open = async (p: Page) => {
      await routeDrafts(p, { empty: false });
      await routeInbox(p, { empty: false });
      await routeDesignWorkbench(p, { extraProjects: [R7_PROJECT] });
      await routeEvalComments(p, store);
      await p.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
      await p.getByTestId("design-detail").waitFor();
      await p.getByTestId("design-detail-view-single").click();
      await p.getByTestId("design-detail-mode-comment").click();
      return p.getByTestId("design-detail-phone");
    };
    const phoneA = await open(page);
    await phoneA.locator('[data-node-id="r7-title"]').click();
    await page.getByTestId("design-comment-input").fill("标题换成更口语的说法");
    await page.getByTestId("design-comment-save").click();
    await expect(page.getByTestId("design-comment-item")).toHaveCount(1);
    expect(store.get("eval-R7")?.map((c) => [c.nodeId, c.text])).toEqual([["r7-title", "标题换成更口语的说法"]]);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await ctx.newPage();
    const phoneB = await open(other);
    await expect(other.getByTestId("design-comment-item")).toContainText("标题换成更口语的说法");
    await expect(phoneB.getByTestId("design-comment-pin")).toHaveCount(1);

    store.get("eval-R7")![0]!.resolved = true;
    await other.reload();
    await other.getByTestId("design-detail").waitFor();
    await other.getByTestId("design-detail-view-single").click();
    await other.getByTestId("design-detail-mode-comment").click();
    await expect(other.getByTestId("design-comment-item")).toHaveAttribute("data-resolved", "true");
    await ctx.close();
  });
});

test.describe("深度 S3 批注讨论（#3988）", () => {
  test("回一句 ⇒ 挂在批注下、服务端存上；标记解决 ⇒ 钉消失；重新打开 ⇒ 钉回来；换个浏览器看得到这段讨论", async ({ page, browser }) => {
    const store = newCommentStore();
    const open = async (p: Page) => {
      await routeDrafts(p, { empty: false });
      await routeInbox(p, { empty: false });
      await routeDesignWorkbench(p, { extraProjects: [R7_PROJECT] });
      await routeEvalComments(p, store);
      await p.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
      await p.getByTestId("design-detail").waitFor();
      await p.getByTestId("design-detail-view-single").click();
      await p.getByTestId("design-detail-mode-comment").click();
      return p.getByTestId("design-detail-phone");
    };
    const phone = await open(page);
    await phone.locator('[data-node-id="r7-agree"]').click();
    await page.getByTestId("design-comment-input").fill("默认不要勾上");
    await page.getByTestId("design-comment-save").click();
    const item = page.getByTestId("design-comment-item").first();
    await item.getByTestId("design-comment-reply").click();
    await item.getByTestId("design-comment-reply-input").fill("同意，合规要求");
    await item.getByTestId("design-comment-reply-save").click();
    await expect(item).toContainText("同意，合规要求");
    expect(store.get("eval-R7")?.[0]?.replies.map((r) => r.text)).toEqual(["同意，合规要求"]);

    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);
    await item.getByTestId("design-comment-resolve").click();
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(0);
    await page.getByTestId("design-comment-item").first().getByTestId("design-comment-reopen").click();
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await ctx.newPage();
    await open(other);
    await expect(other.getByTestId("design-comment-item").first()).toContainText("同意，合规要求");
    await ctx.close();
  });
});

test.describe("深度 S4 导出的代码能交互（#3988）", () => {
  test("导出的 .tsx 里 tabs 是真状态：useState 登记、点下去 setter 切到那一项、选中态读状态", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-code").click()]);
    const tsx = readFileSync(await d.path(), "utf8");
    // R7 的 tabs「详情 / 规格」active=0：登记成 useState(0)，第二项点下去 setS1(1)，选中态是 s1 === 1。
    expect(tsx).toMatch(/const \[s1, setS1\] = useState\(0\);/);
    expect(tsx).toContain("onClick={() => { setS1(1); }}");
    expect(tsx).toContain("aria-selected={s1 === 1}");
  });
});

const S5_PROJECT = {
  ...R3_PROJECT, id: "eval-S5", name: "周报", frames: ["首页"], frameNotes: [""],
  prototype: [{ id: "s5-root", type: "stack", props: { direction: "column", gap: "md", padding: "md" }, children: [
    { id: "s5-share", type: "button", props: { label: "分享周报", icon: "share" } },
    { id: "s5-list", type: "list", props: { items: ["个人资料", "账号安全"], leading: "icon", icons: ["user", "lock"] } },
    { id: "s5-nav", type: "bottomnav", props: { items: ["首页", "我的"] } },
  ] }],
};

test.describe("深度 S5 导出的代码带图标（#3988）", () => {
  test("导出的 .tsx 里每个用到的图标是一个内联 SVG 组件，按钮 / 列表 / 底部导航都引用它；仍只 import react", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [S5_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=S5");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-code").click()]);
    const tsx = readFileSync(await d.path(), "utf8");
    // 按钮的 share、列表的 user / lock、底部导航按标签猜出的首页 → home、我的 → user（与画布同一个 guessNavIcon）。
    for (const name of ["IconShare", "IconUser", "IconLock", "IconHome"]) {
      expect(tsx).toContain(`function ${name}() {`);
      expect(tsx).toContain(`<${name} />`);
    }
    expect(tsx).toMatch(/function IconShare\(\) \{\n  return \(<svg [^]*?<\/svg>\);/);
    expect([...tsx.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1])).toEqual(["react"]);
  });
});

test.describe("深度 S6 编辑器里看代码（#3988）", () => {
  test("点「代码」：右栏是导出的那一份 React 代码（与下载的 .tsx 逐字相同）；再点一次收起", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [S5_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=S5");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-code").click();
    await expect(page.getByTestId("design-detail-code")).toHaveAttribute("aria-pressed", "true");
    const panel = page.getByTestId("design-code-panel");
    await expect(panel).toContainText("function IconShare()");
    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-code").click()]);
    expect(await panel.textContent()).toBe(readFileSync(await d.path(), "utf8"));
    await page.getByTestId("design-detail-code").click();
    await expect(panel).toHaveCount(0);
  });
});

const S7_PROJECT = {
  ...R3_PROJECT, id: "eval-S7", name: "路演", frames: ["封面", "团队"], frameNotes: ["", ""],
  prototype: [
    { id: "s7-a", type: "stack", children: [{ id: "s7-a-t", type: "text", props: { content: "轻账路演封面", variant: "title" } }] },
    { id: "s7-b", type: "stack", children: [{ id: "s7-b-t", type: "text", props: { content: "创始团队三人", variant: "title" } }] },
  ],
};

test.describe("深度 S7 演示模式（#3988）", () => {
  test("点「演示」：编辑器离屏、整屏放第一页；→ 翻到第二页、页码 2 / 2；Esc 回到编辑器", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [S7_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=S7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-present").click();
    const stage = page.getByTestId("design-present");
    await expect(stage).toContainText("轻账路演封面");
    await expect(page.getByTestId("design-detail")).toHaveCount(0);
    await expect(page.getByTestId("design-present-counter")).toHaveText("1 / 2");
    await page.keyboard.press("ArrowRight");
    await expect(stage).toContainText("创始团队三人");
    await expect(page.getByTestId("design-present-counter")).toHaveText("2 / 2");
    await page.keyboard.press("Escape");
    await expect(stage).toHaveCount(0);
    await expect(page.getByTestId("design-detail-canvas")).toBeVisible();
  });
});

test.describe("深度 S8 导出 PPTX（#3988）", () => {
  test("导出菜单「幻灯片（.pptx）」：真 Next 打包下能导出，ASCII 文件名，两页进两页出", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [S7_PROJECT] });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=S7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-pptx").click()]);
    expect(d.suggestedFilename()).toMatch(/^[\x20-\x7e]+\.pptx$/);
    const buf = readFileSync(await d.path());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    // .pptx 里文件名以明文存在 zip 目录里；幻灯片正文是压缩过的，逐页的字交给单测拆包核对。
    const names = buf.toString("latin1");
    expect(names).toContain("ppt/slides/slide1.xml");
    expect(names).toContain("ppt/slides/slide2.xml");
    expect(names).not.toContain("ppt/slides/slide3.xml");
  });
});

test.describe("深度 S9 变体：对照、提要求、要几个（#3988）", () => {
  test("方案旁摆着当前页；写一句要求、选 2 个再出一组 ⇒ 请求带着它们，只出 2 个", async ({ page }) => {
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [R7_PROJECT] });
    const asked: { count?: number; instruction?: string }[] = [];
    const variant = (tag: string) => ({ type: "stack", children: [{ type: "text", props: { content: `会员 · ${tag}`, variant: "title" } }] });
    await page.route((url) => /^\/pm-designs\/eval-R7\/variants$/.test(url.pathname), async (route) => {
      const body = route.request().postDataJSON() as { count?: number; instruction?: string };
      asked.push(body);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        variants: ["甲", "乙", "丙", "丁"].slice(0, body.count ?? 3).map((t) => ({ summary: `方案${t}`, root: variant(`方案${t}`) })),
      }) });
    });
    await page.goto("/preview/feedback-design-loop?scene=detail-eval&case=R7");
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-variants").click();
    await expect(page.getByTestId("design-variant-current")).toContainText("年度会员 · 专业版");
    await expect(page.getByTestId("design-variant-2")).toBeVisible();
    expect(asked[0]).toEqual({ screen: 0 });
    await page.getByTestId("design-variants-instruction").fill("突出价格");
    await page.getByTestId("design-variants-count").selectOption("2");
    await page.getByTestId("design-variants-regenerate").click();
    await expect.poll(() => asked.length).toBe(2);
    expect(asked[1]).toEqual({ screen: 0, count: 2, instruction: "突出价格" });
    await expect(page.getByTestId("design-variant-1")).toBeVisible();
    await expect(page.getByTestId("design-variant-2")).toHaveCount(0);
  });
});
