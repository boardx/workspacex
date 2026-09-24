/**
 * 设计工作台深度评测（S0，2026-09-24 冻结）。
 *
 * 对标评测（`design-parity.eval.ts`，42 条）在 R10 已经全部通过。它量的是「这项能力有没有」；
 * 这一把量的是**有了之后够不够用**——R1–R10 收尾时自己登记的那几处短板：批注只在本机、导出的代码
 * 是静态骨架、看不到代码、放不进真图片、幻灯片不能演示也导不出 PPT、变体没法提要求、页面文件逼近上限。
 *
 * 规则与对标评测相同：每条检查是真浏览器里一个用户看得见的结果；标题以 `[Vx.cy]` 开头归维度；
 * 维度定义只在 `score.mjs` 的 `DEPTH_DIMENSIONS` 里写一次；冻结后只修评测自身的 bug 并在 README 记账。
 * V9 是唯一不看界面的一维（代码规模），理由见那一节。
 *
 * ⚠ 生成质量（AI 画得好不好）**仍然不在这里**：本容器没有真实模型凭据。见 README「它不量什么」。
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../../scripts/lib/design-loop-fixtures.mjs";
import { EVAL_PROJECTS } from "./cases.mjs";
import { routeEvalEditing } from "./eval-api";
import { newCommentStore, routeEvalComments, type CommentStore } from "./depth-api";

test.use({
  launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {},
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

const WEB = resolve(__dirname, "..", "..");
const ROOT = resolve(WEB, "..", "..");

/* ───────────────────────────── helpers ───────────────────────────── */

type Proj = (typeof EVAL_PROJECTS)[number];

async function openCase(page: Page, caseId: string, opts: { store?: CommentStore } = {}): Promise<Proj[]> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  const projects = (await routeDesignWorkbench(page, { extraProjects: structuredClone(EVAL_PROJECTS) })) as Proj[];
  await routeEvalEditing(page, projects as never);
  if (opts.store !== undefined) await routeEvalComments(page, opts.store);
  await page.goto(`/preview/feedback-design-loop?scene=detail-eval&case=${caseId}`);
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-canvas").waitFor();
  return projects;
}

async function single(page: Page, frame = 0): Promise<Locator> {
  await page.getByTestId("design-detail-view-single").click();
  if (frame > 0) await page.getByTestId(`design-detail-frame-${frame}`).click();
  const phone = page.getByTestId("design-detail-phone");
  await expect(phone).toHaveCount(1);
  return phone;
}

const node = (scope: Page | Locator, id: string) => scope.locator(`[data-node-id="${id}"]`).first();

async function downloadOf(page: Page, trigger: () => Promise<void>): Promise<{ name: string; buf: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), trigger()]);
  return { name: d.suggestedFilename(), buf: readFileSync(await d.path()) };
}

async function exportMenu(page: Page): Promise<void> {
  await page.getByTestId("design-detail-export").click();
  await page.getByTestId("design-detail-export-menu").waitFor();
}

function listen(page: Page, re: RegExp, method?: string): { method: string; path: string; body: unknown }[] {
  const seen: { method: string; path: string; body: unknown }[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (!re.test(path) || req.method() === "GET" || (method !== undefined && req.method() !== method)) return;
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { body = req.postData(); }
    seen.push({ method: req.method(), path, body });
  });
  return seen;
}

/** 批注模式下给某个节点钉一句。 */
async function pin(page: Page, phone: Locator, nodeId: string, text: string): Promise<void> {
  await node(phone, nodeId).click();
  await page.getByTestId("design-comment-input").fill(text);
  await page.getByTestId("design-comment-save").click();
}

async function commentMode(page: Page): Promise<Locator> {
  const phone = await single(page);
  await page.getByTestId("design-detail-mode-comment").click();
  return phone;
}

/**
 * 把导出的 .tsx 真的放进浏览器里跑：esbuild 把它连同 react / react-dom 打成一个脚本，
 * 塞进一张空白页。量的是「工程拿到能不能直接用」，所以不看源码里有没有某个词，看渲染出来点得动不动。
 * esbuild 不是 web 的直接依赖（pnpm 不给解析），从仓库的 .pnpm 目录里取——评测工具，不进产品。
 */
/** 评测只用到 esbuild 的这一小块 API；它不是 web 的依赖，类型也就不从它那里拿。 */
interface EsbuildPluginBuild {
  onResolve(o: { filter: RegExp }, cb: () => { path: string; namespace: string }): void;
  onLoad(o: { filter: RegExp; namespace: string }, cb: () => { contents: string; loader: "tsx"; resolveDir: string }): void;
}
interface Esbuild { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> }

async function runExportedTsx(browser: Browser, tsx: string): Promise<Page> {
  const pnpm = join(ROOT, "node_modules", ".pnpm");
  const dir = readdirSync(pnpm).filter((d) => /^esbuild@\d/.test(d)).sort().at(-1);
  if (dir === undefined) throw new Error("仓库里找不到 esbuild（评测需要它把导出的代码打包进浏览器）");
  const esbuild = createRequire(__filename)(join(pnpm, dir, "node_modules", "esbuild")) as Esbuild;
  const out = await esbuild.build({
    stdin: {
      contents: `import { createRoot } from "react-dom/client";\nimport Prototype from "./__exported__";\ncreateRoot(document.getElementById("root")!).render(<Prototype />);`,
      loader: "tsx", resolveDir: WEB,
    },
    plugins: [{
      name: "exported", setup(b: EsbuildPluginBuild) {
        b.onResolve({ filter: /^\.\/__exported__$/ }, () => ({ path: "exported.tsx", namespace: "exported" }));
        b.onLoad({ filter: /.*/, namespace: "exported" }, () => ({ contents: tsx, loader: "tsx", resolveDir: WEB }));
      },
    }],
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  const p = await browser.newPage();
  await p.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await p.addScriptTag({ content: out.outputFiles[0]!.text });
  await p.locator("#root > *").first().waitFor();
  return p;
}

async function exportedTsx(page: Page, caseId: string): Promise<string> {
  await openCase(page, caseId);
  await exportMenu(page);
  const { buf } = await downloadOf(page, () => page.getByTestId("design-detail-export-code").click());
  return buf.toString("utf8");
}

/* ───────────────────────────── V1 批注跨设备 ───────────────────────────── */

test.describe("V1 批注跨设备", () => {
  test("[V1.c1] 写一条批注 ⇒ 交给服务端保存（请求带节点、页、原话）", async ({ page }) => {
    await openCase(page, "E02", { store: newCommentStore() });
    const posts = listen(page, /^\/pm-designs\/eval-E02\/comments$/, "POST");
    const phone = await commentMode(page);
    await pin(page, phone, "e02-buy", "按钮再醒目一点");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]!.body).toMatchObject({ nodeId: "e02-buy", frameIndex: 0, text: "按钮再醒目一点" });
  });

  test("[V1.c2] 换一台电脑（新浏览器）打开同一个项目，看得到这条批注和它的图钉", async ({ page, browser }) => {
    const store = newCommentStore();
    await openCase(page, "E02", { store });
    await pin(page, await commentMode(page), "e02-buy", "按钮再醒目一点");
    await expect(page.getByTestId("design-comment-item")).toHaveCount(1);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await ctx.newPage();
    await openCase(other, "E02", { store });
    const phone = await commentMode(other);
    await expect(other.getByTestId("design-comment-item")).toContainText("按钮再醒目一点", { timeout: 5000 });
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);
    await ctx.close();
  });

  test("[V1.c3] 清掉浏览器存储再刷新，批注还在", async ({ page }) => {
    const store = newCommentStore();
    await openCase(page, "E02", { store });
    await pin(page, await commentMode(page), "e02-agree", "默认不要勾上");
    await expect(page.getByTestId("design-comment-item")).toHaveCount(1);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    await commentMode(page);
    await expect(page.getByTestId("design-comment-item")).toContainText("默认不要勾上", { timeout: 5000 });
  });
});

/* ───────────────────────────── V2 批注讨论 ───────────────────────────── */

test.describe("V2 批注讨论", () => {
  test("[V2.c1] 回复一条批注：回复显示在它下面，并交给服务端", async ({ page }) => {
    await openCase(page, "E02", { store: newCommentStore() });
    const replies = listen(page, /^\/pm-designs\/eval-E02\/comments\/[^/]+\/replies$/, "POST");
    await pin(page, await commentMode(page), "e02-buy", "按钮再醒目一点");
    const item = page.getByTestId("design-comment-item").first();
    await item.getByTestId("design-comment-reply").click({ timeout: 3000 });
    await item.getByTestId("design-comment-reply-input").fill("同意，用主色");
    await item.getByTestId("design-comment-reply-save").click();
    await expect(item).toContainText("同意，用主色");
    await expect.poll(() => replies.length).toBe(1);
  });

  test("[V2.c2] 标记解决：图钉消失、这条归到已解决", async ({ page }) => {
    await openCase(page, "E02", { store: newCommentStore() });
    const patches = listen(page, /^\/pm-designs\/eval-E02\/comments\/[^/]+$/, "PATCH");
    const phone = await commentMode(page);
    await pin(page, phone, "e02-buy", "按钮再醒目一点");
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);
    await page.getByTestId("design-comment-item").first().getByTestId("design-comment-resolve").click({ timeout: 3000 });
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(0);
    await expect.poll(() => patches.at(-1)?.body).toMatchObject({ resolved: true });
  });

  test("[V2.c3] 已解决的可以重新打开，图钉回来", async ({ page }) => {
    await openCase(page, "E02", { store: newCommentStore() });
    const phone = await commentMode(page);
    await pin(page, phone, "e02-buy", "按钮再醒目一点");
    await page.getByTestId("design-comment-item").first().getByTestId("design-comment-resolve").click({ timeout: 3000 });
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(0);
    await page.getByTestId("design-comment-item").first().getByTestId("design-comment-reopen").click({ timeout: 3000 });
    await expect(phone.getByTestId("design-comment-pin")).toHaveCount(1);
  });
});

/* ───────────────────────────── V3 导出的代码能交互 ───────────────────────────── */

test.describe("V3 导出的代码能交互", () => {
  test("[V3.c1] 导出的组件里 tabs 点得动：点「规格」，它变成选中", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E02"));
    await app.getByRole("tab", { name: "规格" }).click();
    await expect(app.getByRole("tab", { name: "规格" })).toHaveAttribute("aria-selected", "true");
    await expect(app.getByRole("tab", { name: "详情" })).toHaveAttribute("aria-selected", "false");
  });

  test("[V3.c2] 开关拨得动、勾选勾得上", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E02"));
    const sw = app.getByRole("switch", { name: "到期自动续费" });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await expect(sw).toBeChecked();
    const box = app.getByRole("checkbox", { name: "我已阅读并同意会员协议" });
    await box.click();
    await expect(box).toBeChecked();
  });

  test("[V3.c3] 底部导航的项跳得到对应页，而且当前项跟着变", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E01"));
    const nav = app.getByRole("navigation", { name: "底部导航" }).first();
    await nav.getByText("历史", { exact: true }).click();
    await expect(app.getByText("历史会话", { exact: false }).first()).toBeVisible();
    await expect(app.getByRole("navigation", { name: "底部导航" }).first().getByRole("button", { name: "历史" })).toHaveAttribute("aria-current", "page");
  });
});

/* ───────────────────────────── V4 导出的代码带图标 ───────────────────────────── */

test.describe("V4 导出的代码带图标", () => {
  test("[V4.c1] 带图标的按钮，导出后按钮里有这个图标（SVG）", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E10"));
    await expect(app.getByRole("button", { name: "分享周报" }).locator("svg")).toHaveCount(1);
  });

  test("[V4.c2] 底部导航每一项都有图标", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E01"));
    const nav = app.getByRole("navigation", { name: "底部导航" }).first();
    await expect(nav.locator("button svg")).toHaveCount(3);
  });

  test("[V4.c3] 图标列表每一行前面有图标", async ({ page, browser }) => {
    const app = await runExportedTsx(browser, await exportedTsx(page, "E06"));
    const rows = app.locator("li").filter({ hasText: /个人资料|账号安全|通知/ });
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(rows.nth(i).locator("svg")).toHaveCount(1);
  });
});

/* ───────────────────────────── V5 查看代码 ───────────────────────────── */

test.describe("V5 查看代码", () => {
  test("[V5.c1] 点「代码」：面板里是这个原型的 React 代码，含当前页的文案", async ({ page }) => {
    await openCase(page, "E02");
    await single(page);
    await page.getByTestId("design-detail-code").click({ timeout: 3000 });
    const panel = page.getByTestId("design-code-panel");
    await expect(panel).toContainText("export default function");
    await expect(panel).toContainText("年度会员 · 专业版");
  });

  test("[V5.c2] 一键复制：剪贴板里就是这份代码", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openCase(page, "E02");
    await single(page);
    await page.getByTestId("design-detail-code").click({ timeout: 3000 });
    await page.getByTestId("design-code-copy").click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("export default function");
    expect(clip).toContain("立即购买");
  });

  test("[V5.c3] 在画布上改了字，面板里的代码跟着变", async ({ page }) => {
    await openCase(page, "E02");
    const phone = await single(page);
    await page.getByTestId("design-detail-code").click({ timeout: 3000 });
    await phone.getByText("年度会员 · 专业版").dblclick();
    await phone.getByTestId("design-canvas-inline-edit").waitFor();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("年度会员 · 旗舰版");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("design-code-panel")).toContainText("年度会员 · 旗舰版");
  });
});

/* ───────────────────────────── V6 真实图片 ───────────────────────────── */

/*
 * 原型里的 image 节点只能是一块灰底 + 说明文字的占位。做商品页、餐厅页、个人主页时，
 * 放不进一张真图，评审的人只能靠想象。这一维量「把占位换成真图」这件事做不做得到、存不存得住、
 * 交不交得出去。
 */

/** 一张 64×48 的纯色 PNG（浏览器里现画现取），当作用户上传的照片。 */
async function samplePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 48;
    const g = c.getContext("2d")!; g.fillStyle = "#d9480f"; g.fillRect(0, 0, 64, 48); g.fillStyle = "#ffd43b"; g.fillRect(8, 8, 24, 16);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

/** 选中 E02 的商品主图（第一个 image 节点），在属性面板里换成上传的图片。 */
async function uploadIntoImage(page: Page): Promise<Locator> {
  await openCase(page, "E02");
  const phone = await single(page);
  await phone.locator('[data-proto="image"]').first().click();
  await page.getByTestId("design-inspector-image-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: await samplePng(page) }, { timeout: 3000 });
  return phone;
}

const loadedImg = (scope: Locator | Page) => scope.locator('[data-proto="image"] img').first();
const naturalWidth = (l: Locator) => l.evaluate((el) => (el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0);

test.describe("V6 真实图片", () => {
  test("[V6.c1] 选中占位图、上传一张图片：画布上这块变成这张图", async ({ page }) => {
    const phone = await uploadIntoImage(page);
    await expect(loadedImg(phone)).toBeVisible({ timeout: 5000 });
    await expect.poll(() => naturalWidth(loadedImg(phone))).toBeGreaterThan(0);
  });

  test("[V6.c2] 刷新之后图片还在（写进了设计本身，不是只在这个页面上）", async ({ page }) => {
    const phone = await uploadIntoImage(page);
    await expect(loadedImg(phone)).toBeVisible({ timeout: 5000 });
    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    const again = await single(page);
    await expect(loadedImg(again)).toBeVisible({ timeout: 5000 });
    await expect.poll(() => naturalWidth(loadedImg(again))).toBeGreaterThan(0);
  });

  test("[V6.c3] 导出的 React 代码里也带着这张图", async ({ page, browser }) => {
    const phone = await uploadIntoImage(page);
    await expect(loadedImg(phone)).toBeVisible({ timeout: 5000 });
    await exportMenu(page);
    const { buf } = await downloadOf(page, () => page.getByTestId("design-detail-export-code").click());
    const app = await runExportedTsx(browser, buf.toString("utf8"));
    const img = app.locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
});

/* ───────────────────────────── V7 演示模式 ───────────────────────────── */

test.describe("V7 演示模式", () => {
  test("[V7.c1] 点「演示」：全屏只放第一页，不带编辑器的界面", async ({ page }) => {
    await openCase(page, "E07");
    await page.getByTestId("design-detail-present").click({ timeout: 3000 });
    const stage = page.getByTestId("design-present");
    await expect(stage).toContainText("轻账：小微企业的自动财务");
    const box = await stage.boundingBox();
    expect(box !== null && box.width >= 1400 && box.height >= 880).toBe(true);
    await expect(page.getByTestId("design-detail-input")).not.toBeInViewport();
  });

  test("[V7.c2] 方向键翻页，页码跟着走", async ({ page }) => {
    await openCase(page, "E07");
    await page.getByTestId("design-detail-present").click({ timeout: 3000 });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("design-present")).toContainText("¥3,200 亿");
    await expect(page.getByTestId("design-present-counter")).toContainText(/2\s*\/\s*3/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("design-present-counter")).toContainText(/1\s*\/\s*3/);
  });

  test("[V7.c3] Esc 退出，回到编辑器", async ({ page }) => {
    await openCase(page, "E07");
    await page.getByTestId("design-detail-present").click({ timeout: 3000 });
    await page.getByTestId("design-present").waitFor();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("design-present")).toHaveCount(0);
    await expect(page.getByTestId("design-detail-canvas")).toBeVisible();
  });
});

/* ───────────────────────────── V8 变体：提要求、对照、数量 ───────────────────────────── */

async function routeVariants(page: Page): Promise<unknown[]> {
  const seen: unknown[] = [];
  const v = (tag: string) => ({ type: "stack", children: [{ type: "text", props: { content: `年度会员 · ${tag}`, variant: "title" } }] });
  await page.route((url) => /^\/pm-designs\/eval-E02\/variants$/.test(url.pathname), async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { count?: number };
    seen.push(body);
    const n = body.count ?? 3;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      variants: ["A", "B", "C", "D"].slice(0, n).map((t) => ({ summary: `方案 ${t}`, root: v(`方案 ${t}`) })),
    }) });
  });
  return seen;
}

test.describe("V8 变体：提要求、对照、数量", () => {
  test("[V8.c1] 方案旁边摆着「当前」这一页，方便对照", async ({ page }) => {
    await openCase(page, "E02");
    await routeVariants(page);
    await single(page);
    await page.getByTestId("design-detail-variants").click();
    await expect(page.getByTestId("design-variant-current")).toContainText("年度会员 · 专业版", { timeout: 3000 }); // testid-gate: absent 深度评测的目标接口，实现它的那一轮删掉本标注（#3988）
  });

  test("[V8.c2] 写一句要求再出一组：请求带着这句话", async ({ page }) => {
    await openCase(page, "E02");
    const seen = await routeVariants(page);
    await single(page);
    await page.getByTestId("design-detail-variants").click();
    await page.getByTestId("design-variants-instruction").fill("更简洁，少一点文字", { timeout: 3000 }); // testid-gate: absent 深度评测的目标接口，实现它的那一轮删掉本标注（#3988）
    await page.getByTestId("design-variants-regenerate").click(); // testid-gate: absent 深度评测的目标接口，实现它的那一轮删掉本标注（#3988）
    await expect.poll(() => seen.at(-1)).toMatchObject({ screen: 0, instruction: "更简洁，少一点文字" });
  });

  test("[V8.c3] 选要几个方案：选 2 个，就出 2 个", async ({ page }) => {
    await openCase(page, "E02");
    const seen = await routeVariants(page);
    await single(page);
    await page.getByTestId("design-detail-variants").click();
    await page.getByTestId("design-variants-count").selectOption("2", { timeout: 3000 });
    await page.getByTestId("design-variants-regenerate").click(); // testid-gate: absent 深度评测的目标接口，实现它的那一轮删掉本标注（#3988）
    await expect.poll(() => seen.at(-1)).toMatchObject({ count: 2 });
    await expect(page.getByTestId("design-variant-1")).toBeVisible();
    await expect(page.getByTestId("design-variant-2")).toHaveCount(0);
  });
});

/* ───────────────────────────── V9 代码规模 ───────────────────────────── */

/*
 * 唯一不看界面的一维。仓库规则：业务文件原则上不超过 2000 行，逼近上限要按职责拆。详情页
 * `detail-screen.tsx` 在 R10 收尾时是 1888 行——再加两轮功能就过线，而后面几轮（批注讨论、查看代码、
 * 演示、真实图片）全都要往它身上加。这一维量的是「后面的功能还有地方放」，所以线划在 1500，
 * 给每一轮留出余量，而不是等撞上 2000 再拆。
 */
const lines = (rel: string) => readFileSync(join(WEB, rel), "utf8").split("\n").length;
const DESIGN_LOOP = "components/design-loop";

test.describe("V9 代码规模", () => {
  test("[V9.c1] 详情页 detail-screen.tsx 不超过 1500 行", () => {
    expect(lines(`${DESIGN_LOOP}/detail-screen.tsx`)).toBeLessThanOrEqual(1500);
  });

  test("[V9.c2] 设计工作台没有任何一个组件文件超过 1500 行", () => {
    const big = readdirSync(join(WEB, DESIGN_LOOP)).filter((f) => f.endsWith(".tsx")).map((f) => [f, lines(`${DESIGN_LOOP}/${f}`)] as const).filter(([, n]) => n > 1500);
    expect(big).toEqual([]);
  });
});

/* ───────────────────────────── V10 幻灯片导出 PPTX ───────────────────────────── */

/** 读 zip 的中央目录（不解压）：PPTX 就是一个 zip，量「里面有几页幻灯片、第几页写了什么」。 */
function zipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const inflate = createRequire(__filename)("node:zlib") as typeof import("node:zlib");
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(lStart, lStart + csize);
    out.set(name, method === 8 ? inflate.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function pptx(page: Page): Promise<{ name: string; entries: Map<string, Buffer> }> {
  await openCase(page, "E07");
  await exportMenu(page);
  const { name, buf } = await downloadOf(page, () => page.getByTestId("design-detail-export-pptx").click({ timeout: 3000 }));
  return { name, entries: zipEntries(buf) };
}

test.describe("V10 幻灯片导出 PPTX", () => {
  test("[V10.c1] 幻灯片项目能导出 .pptx（是个像样的 PowerPoint 包）", async ({ page }) => {
    const { name, entries } = await pptx(page);
    expect(name).toMatch(/\.pptx$/);
    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("ppt/presentation.xml")).toBe(true);
  });

  test("[V10.c2] 几页幻灯片就是几页：三页进三页出", async ({ page }) => {
    const { entries } = await pptx(page);
    expect([...entries.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(3);
  });

  test("[V10.c3] 每页的文字都在，能在 PowerPoint 里改（不是一张图）", async ({ page }) => {
    const { entries } = await pptx(page);
    expect(entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "").toContain("轻账：小微企业的自动财务");
    expect(entries.get("ppt/slides/slide2.xml")?.toString("utf8") ?? "").toContain("¥3,200 亿");
    expect(entries.get("ppt/slides/slide3.xml")?.toString("utf8") ?? "").toContain("CTO 许言");
  });
});
