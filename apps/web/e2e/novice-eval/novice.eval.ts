import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AA_LARGE, AA_NORMAL, auditTextContrast } from "../support/text-contrast";
import { CLUTTER_BUDGET, JARGON, STEP_BUDGET, type Dim } from "./score.mjs";
import { loadRecorded, routeNovice } from "./novice-api";

/**
 * 设计工作台 · 普通用户评测集（机器分那一半）。评分规则、预算、术语表见 `score.mjs`（唯一事实源）。
 *
 * 普通用户 = 不懂设计也不懂工程的业务人员。每条旅程都**按他会找的方式找控件**：按按钮上写的字
 * （`getByRole(..., { name })`），不按 testid——找不到就说明这个字他看不懂 / 看不到，那本身就是扣分项。
 * testid 只用来**核对结果**（画布上是不是真的变了）。
 *
 * ⚠ 这是**评测**不是门：检查不过只记分、不让用例红（基线本来就不会满分）。用例红只意味着
 *   评测本身跑不下去（页面没起来、夹具坏了）——那种红要修评测，不是记一条扣分。
 *   稳定性：全部走夹具路由（`novice-api.ts`），生成结果是真实模型录下的原样输出，无网络、无模型。
 */
const OUT = process.env.NOVICE_OUT ?? join(process.cwd(), "test-results", "novice-eval");
mkdirSync(OUT, { recursive: true });
/**
 * 每条检查**立刻追加写盘**：一条旅程抛错时 Playwright 会重启 worker，内存里攒的记录会丢。
 * 打分在 `global-teardown.ts` 里读这份文件做（`global-setup.ts` 开跑前清空它）。
 */
const record = (id: string, dim: Dim, pass: boolean, detail: string): void => {
  appendFileSync(join(OUT, "checks.jsonl"), `${JSON.stringify({ id, dim, pass, detail })}\n`);
};
/** 一条旅程跑不下去（找不到页面、超时）⇒ 记成这条任务没做成，不连累别的旅程。 */
async function journey(taskId: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    record(`${taskId}.aborted`, "task", false, `旅程中断：${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 160)}`);
  }
}

test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {} });

/** 首屏（不滚动）里、原型画面之外的可操作控件与可见文字。 */
async function firstScreen(page: Page): Promise<{ controls: string[]; text: string }> {
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const inViewport = (el: Element): boolean => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const inPrototype = (el: Element): boolean => el.closest("[data-proto], [data-board-frame], [data-testid='design-detail-phone']") !== null;
    // 被遮罩盖住的点不到，不算（弹窗打开时背后那一屏）。
    const reachable = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const dialog = document.querySelector("[role=dialog], [aria-modal=true]");
    const root: ParentNode = dialog ?? document;
    const controls = Array.from(root.querySelectorAll("button, a[href], input, textarea, select, [role=button], [role=tab]"))
      .filter((el) => inViewport(el) && !inPrototype(el) && !(el as HTMLButtonElement).disabled && reachable(el))
      .map((el) => ((el.getAttribute("aria-label") ?? (el as HTMLElement).innerText) || (el as HTMLInputElement).placeholder || el.getAttribute("title") || "?").trim().replace(/\s+/g, " ").slice(0, 30));
    const parts: string[] = [];
    const walker = document.createTreeWalker(dialog ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el === null || inPrototype(el) || !inViewport(el) || (n.textContent ?? "").trim() === "") continue;
      parts.push((n.textContent ?? "").trim());
    }
    for (const el of Array.from(root.querySelectorAll("[title], [aria-label], input[placeholder], textarea[placeholder]"))) {
      if (!inViewport(el) || inPrototype(el)) continue;
      parts.push(el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "", (el as HTMLInputElement).placeholder ?? "");
    }
    return { controls, text: parts.join(" ") };
  });
}

async function judgeScreen(page: Page, name: keyof typeof CLUTTER_BUDGET): Promise<void> {
  const { controls, text } = await firstScreen(page);
  const budget = CLUTTER_BUDGET[name];
  record(`clutter.${name}`, "clutter", controls.length <= budget, `首屏 ${String(controls.length)} 个可操作控件（预算 ${String(budget)}）：${controls.join("、")}`);
  const hits = JARGON.filter((w) => text.includes(w));
  record(`jargon.${name}`, "jargon", hits.length === 0, hits.length === 0 ? "首屏没有术语" : `首屏出现术语：${hits.join("、")}`);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function contrast(page: Page, id: string): Promise<void> {
  const r = await page.evaluate(auditTextContrast, { aaNormal: AA_NORMAL, aaLarge: AA_LARGE });
  record(`access.contrast.${id}`, "access", r.examined > 10 && r.fail.length === 0,
    r.examined <= 10 ? `只审到 ${String(r.examined)} 个元素，拒绝下判断` : r.fail.length === 0 ? `审了 ${String(r.examined)} 个元素，全部达到 AA` : `${String(r.fail.length)} 处低于 AA：${r.fail.slice(0, 4).map((h) => `「${h.sample}」${String(h.ratio)}（${h.fg} on ${h.bg}，${h.tag}${h.testid ? `[${h.testid}]` : ""}）`).join("；")}`);
}

/**
 * 按普通用户的方式找一个控件：按它上面写的字。找不到 ⇒ null（调用方记扣分）。
 *
 * ⚠ 必须**等**，不能立即判：控件常在上一步点击之后才因状态更新出现（选中旧版本 →「退回到这一版」）。
 *   立即判的写法实测三次运行里一次过、两次不过——评测自己在掷骰子。等 3 秒，真没有才算没有。
 */
async function findByLabel(scope: Page | Locator, role: "button" | "tab" | "link", name: RegExp): Promise<Locator | null> {
  const l = scope.getByRole(role, { name }).first();
  return (await l.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) ? l : null;
}

async function openSeededProject(page: Page, title: string): Promise<void> {
  await routeNovice(page, {});
  await page.goto("/preview/feedback-design-loop?scene=workbench");
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await page.getByTestId("design-detail").waitFor();
  await page.getByTestId("design-detail-canvas").waitFor();
}

test("J1 第一次打开工作台：看得懂、知道下一步", async ({ page }) => {
  await journey("j1", async () => {
  await page.emulateMedia({ colorScheme: "light" });
  await routeNovice(page, { empty: true });
  await page.goto("/preview/feedback-design-loop?scene=workbench-empty");
  await page.waitForLoadState("networkidle");
  const start = await findByLabel(page, "button", /新建|开始|创建/);
  record("states.firstRun", "states", start !== null, start === null ? "空工作台上找不到写着「新建 / 开始 / 创建」的按钮" : "空工作台有明确的第一步");

  await routeNovice(page, {});
  await page.goto("/preview/feedback-design-loop?scene=workbench");
  await page.waitForLoadState("networkidle");
  await judgeScreen(page, "workbench");
  await contrast(page, "workbench");
  });
});

test("J2 新建：写一句话 → 等待时知道在干什么 → 看到原型；J4 预览里点按钮能跳页", async ({ page }) => {
  await journey("j2", async () => {
  await page.emulateMedia({ colorScheme: "light" });
  const recorded = loadRecorded("psych-app");
  await routeNovice(page, { recorded, generateMs: 3000 });
  await page.goto("/preview/feedback-design-loop?scene=workbench");
  await page.waitForLoadState("networkidle");
  let steps = 0;

  const create = await findByLabel(page, "button", /新建|开始|创建/);
  expect(create, "找不到新建入口——评测跑不下去").not.toBeNull();
  await create!.click(); steps++;
  await page.waitForTimeout(500);
  await judgeScreen(page, "newDialog");

  // 普通用户只会写他想要什么。
  await page.getByLabel(/想做什么/).or(page.getByPlaceholder(/一句话|想做什么/)).first().fill(recorded.brief); steps++;
  let go = await findByLabel(page, "button", /直接创建|生成|开始|创建/);
  // 同上：按钮的可用态随输入更新，给它一拍再判。
  const enabled = go !== null && (await expect(go).toBeEnabled({ timeout: 1500 }).then(() => true, () => false));
  if (!enabled) {
    record("task.create.nameless", "task", false, "只写了想做什么，创建按钮仍不可点——必须先起名字（普通用户会卡在这）");
    await page.getByPlaceholder(/名字/).fill(recorded.name); steps++;
    go = await findByLabel(page, "button", /直接创建|生成|开始|创建/);
  } else {
    record("task.create.nameless", "task", true, "只写一句想做什么就能创建");
  }
  await go!.click(); steps++;

  // 等待期间：有没有说在干什么、能不能取消。
  await page.waitForTimeout(1200);
  const waitingText = (await page.locator("body").innerText()).slice(0, 4000);
  const saysWhat = /正在|生成|整理|画/.test(waitingText);
  record("states.generating", "states", saysWhat, saysWhat ? "生成中说明了正在做什么" : "生成中没有任何说明");

  const firstNav = (recorded.prototype[0] as { children?: { type: string; props?: { title?: string } }[] }).children?.find((c) => c.type === "navbar")?.props?.title ?? recorded.frames[0]!;
  const appeared = await page.getByTestId("design-detail-canvas").getByText(firstNav).first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
  record("task.create", "task", appeared, appeared ? `原型画出来了（首页「${firstNav}」）` : "20 秒内画布上没出现生成的原型");
  record("steps.create", "steps", steps <= STEP_BUDGET.create, `新建用了 ${String(steps)} 步（预算 ${String(STEP_BUDGET.create)}）`);
  await page.waitForTimeout(800);
  await judgeScreen(page, "detail");
  await contrast(page, "detail");

  // J4 预览：进预览 → 点原型里的主按钮 → 「当前页」应该换到第 2 页。
  // ⚠ 不能用「第 2 页的标题出现在画布上」判：画板视图四页并排，那个标题一直都在，判据恒真。
  //   读「当前是哪一页」（页签的选中态 / 画板上标记为当前的那一块），并先确认点之前是第 1 页。
  const currentFrame = async (): Promise<string | null> => page.evaluate(() => {
    const tab = document.querySelector("[data-testid^='design-detail-frame-'][aria-pressed='true']");
    if (tab !== null) return (tab as HTMLElement).innerText.trim();
    const board = document.querySelector("[data-board-frame][aria-current='page']");
    return board?.getAttribute("data-frame-label") ?? null;
  });
  let pSteps = 0;
  const preview = await findByLabel(page, "button", /预览|试一试|演示/);
  if (preview === null) {
    record("task.preview", "task", false, "找不到写着「预览 / 演示」的按钮");
  } else {
    await preview.click(); pSteps++;
    await page.waitForTimeout(600);
    const before = await currentFrame();
    await page.getByTestId("design-detail-canvas").getByText("记录今天的心情").first().click(); pSteps++;
    await page.waitForTimeout(800);
    const after = await currentFrame();
    const jumped = before === recorded.frames[0] && after === recorded.frames[1];
    record("task.preview", "task", jumped, jumped ? `预览里点按钮从「${before}」跳到了「${after}」` : `预览里点了按钮，当前页 ${String(before)} → ${String(after)}（应为「${recorded.frames[0]}」→「${recorded.frames[1]}」）`);
    record("steps.preview", "steps", pSteps <= STEP_BUDGET.preview, `预览用了 ${String(pSteps)} 步（预算 ${String(STEP_BUDGET.preview)}）`);
  }
  });
});

test("J3 用一句话改、改错了能撤销", async ({ page }) => {
  await journey("j3", async () => {
  await openSeededProject(page, "对话助手移动端");
  const canvas = page.getByTestId("design-detail-canvas");
  await expect(canvas.getByText("＋")).toHaveCount(0);
  let steps = 0;
  await page.getByRole("textbox", { name: /改什么|告诉我/ }).or(page.getByPlaceholder(/改什么|告诉我/)).first().fill("输入区左侧加一个附件按钮"); steps++;
  await page.keyboard.press("Enter"); steps++;
  const changed = await canvas.getByText("＋").first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  record("task.modify", "task", changed, changed ? "说一句话，画布上真的加了按钮" : "发了修改，画布没变");
  record("steps.modify", "steps", steps <= STEP_BUDGET.modify, `修改用了 ${String(steps)} 步（预算 ${String(STEP_BUDGET.modify)}）`);

  const undo = await findByLabel(page, "button", /撤销|回到上一版/);
  if (undo === null) {
    record("task.undo", "task", false, "找不到写着「撤销」的按钮");
  } else {
    await undo.click();
    const reverted = await canvas.getByText("＋").first().waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
    record("task.undo", "task", reverted, reverted ? "一键撤销回到了改之前" : "点了撤销，刚加的按钮还在");
    record("steps.undo", "steps", true, "撤销 1 步");
  }
  });
});

test("J5 分享给同事：拿到一个能发出去的链接", async ({ page }) => {
  await journey("j5", async () => {
  await openSeededProject(page, "对话助手移动端");
  let steps = 0;
  const share = await findByLabel(page, "button", /分享/);
  if (share === null) { record("task.share", "task", false, "找不到「分享」"); return; }
  await share.click(); steps++;
  let url = page.getByTestId("design-share-url");
  if (!(await url.isVisible().catch(() => false))) {
    const publish = await findByLabel(page.getByTestId("design-share-dialog"), "button", /发布|生成链接|创建链接|分享/);
    if (publish !== null) { await publish.click(); steps++; }
    url = page.getByTestId("design-share-url");
  }
  const got = await url.waitFor({ timeout: 8000 }).then(() => true, () => false);
  record("task.share", "task", got, got ? "拿到了分享链接" : "打开分享后没拿到链接");
  record("steps.share", "steps", steps <= STEP_BUDGET.share, `分享用了 ${String(steps)} 步（预算 ${String(STEP_BUDGET.share)}）`);
  });
});

test("J6 找回之前的版本", async ({ page }) => {
  await journey("j6", async () => {
  await openSeededProject(page, "对话助手移动端");
  let steps = 0;
  // 精确匹配：原型里常有叫「历史会话」「历史记录」的页签，模糊匹配会点到用户自己画的页。
  const history = await findByLabel(page, "button", /^\s*(历史|版本|历史版本)\s*$/);
  if (history === null) { record("task.restore", "task", false, "找不到「历史 / 版本」"); return; }
  await history.click(); steps++;
  const first = page.getByTestId("design-history-preview-1");
  if (!(await first.waitFor({ timeout: 8000 }).then(() => true, () => false))) { record("task.restore", "task", false, "历史面板里看不到更早的版本"); return; }
  await first.click(); steps++;
  const restore = await findByLabel(page.getByTestId("design-history"), "button", /恢复|退回|回到这一版/);
  if (restore === null) { record("task.restore", "task", false, "选了旧版本，找不到「恢复 / 退回到这一版」"); return; }
  await restore.click(); steps++;
  // v1 的发送键写的是「发送」（v2 改成了「停止」）。
  const back = await page.getByTestId("design-detail-canvas").getByText("发送", { exact: true }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
  record("task.restore", "task", back, back ? "恢复到了旧版本" : "点了恢复，画布没回到旧版本");
  record("steps.restore", "steps", steps <= STEP_BUDGET.restore, `找回旧版用了 ${String(steps)} 步（预算 ${String(STEP_BUDGET.restore)}）`);
  });
});

test("J7 出错时知道发生了什么、能重来", async ({ page }) => {
  await journey("j7", async () => {
  await routeNovice(page, { failList: true });
  await page.goto("/preview/feedback-design-loop?scene=workbench");
  await page.waitForLoadState("networkidle");
  const body = await page.locator("body").innerText();
  const explains = /没取到|失败|出错|连不上/.test(body);
  const retry = await findByLabel(page, "button", /重试|再试/);
  record("states.listError", "states", explains && retry !== null, `${explains ? "说了出了什么事" : "没说出了什么事"}；${retry !== null ? "有重试" : "没有重试按钮"}`);
  });
});

test("J8 手机上也能用（390 宽）", async ({ page }) => {
  await journey("j8", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeNovice(page, {});
  for (const [id, url] of [["workbench", "/preview/feedback-design-loop?scene=workbench"], ["detail", "/preview/feedback-design-loop?scene=detail-prototype"]] as const) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(`access.narrow.${id}`, "access", overflow <= 1, overflow <= 1 ? "没有横向滚动" : `页面比屏幕宽 ${String(overflow)}px，要横着拖`);
    await page.screenshot({ path: join(OUT, `narrow-${id}.png`) });
  }
  });
});
