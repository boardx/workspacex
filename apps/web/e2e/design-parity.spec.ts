/**
 * 对标评测（#3933）每一轮修掉的差距在这里落一条**回归门**——`e2e/parity-eval/` 是出分的尺子
 * （基线大面积失败、不进 CI），这一份才是门：每轮的行为在真浏览器里被钉住，之后谁把它弄坏谁红。
 *
 * 数据同 `design-prototype-loop.spec.ts`：`page.route` 夹具（`scripts/lib/design-loop-fixtures.mjs`）。
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";

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
