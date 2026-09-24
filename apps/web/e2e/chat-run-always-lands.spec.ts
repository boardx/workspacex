/**
 * **不变量：用户 100% 拿得到结果**（2026-09-24 人类交办：「保证用户 100% 可以得到测试结果」）。
 *
 * ## 为什么把测试方案从「场景枚举」改成「不变量」
 *
 * 上一版矩阵（`deepagent-plan-execute-reliability.spec.ts`）问的是
 * 「这七条路径跑通没有」。它有一个结构性盲区：**只测成功路径**。
 * 而人类最早那张截图、以及「十次五次失败」，痛的从来不是「成功时不够好」，
 * 是**失败时什么都没有**——一直转圈、一屏白、工具调用不回来。
 * 场景枚举永远补不完；不变量能一次覆盖所有场景：
 *
 *   **每一次运行，用户必然在有限时间内看到一个终态。**
 *
 * 终态只有两种，各有各的必要条件：
 *
 *   · **成功** ⇒ 屏幕上有正文或产物。
 *   · **失败** ⇒ 屏幕上说了三件事：失败了、**为什么**、**下一步能做什么**。
 *
 * 两种都必须满足两条横切条件：
 *
 *   · **有限时间**：超过预算仍无终态 = 失败（「一直转圈」就是这一条抓的）。
 *   · **刷新后仍在**：终态只活在内存里 = 用户切走再回来就什么都没有了。
 *
 * ⚠ 本文件**不断言这一轮成功**。注入了故障的那几格，成功反而是可疑的；
 * 它只断言「用户拿到了结果」。这正是「100% 拿得到结果」与「100% 成功」的区别——
 * 后者不可能（上游真的挂了就是挂了），前者必须做到。
 *
 * ## 故障清单（每一条都是真实发生过的形状）
 *
 * | 注入 | 真实对应 |
 * |---|---|
 * | 正常多步 | 基线：不注入故障时同样要落终态 |
 * | run 失败 | 上游 deep-agent 走到错误终态 |
 * | 工具失败 | 一次工具调用失败，整轮仍该继续/收尾 |
 * | 流式中断 | 已经发过正文、半路断（与「一开始就连不上」不同） |
 * | 空手而归 | 调用返回了，但既无文本也无进度事件 |
 * | 长静默 | 模型思考十几秒，期间一条事件都没有 |
 *
 * 环境级故障（数据库不可用 / API origin 配错 / 控制器路由坏）在
 * `fullstack-smoke` 车道有专门的 mode，不在本文件重复注入。
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openChatEmptyState } from "./chat-task-workbench-fixture";
import { ensureAuthedPageOrigin, warmUpCopilotRuntimeRoute } from "./support/chat-path-coverage";
import { openAuthoritativeFreshThread } from "./support/authoritative-thread";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

/** 一次运行允许的最长时间。超过 = 用户等不到结果，就是缺陷。 */
const LANDING_BUDGET_MS = 180_000;
const OUT = join(process.cwd(), "../../evidence/local-desktop/chat-quality/always-lands.md");

interface Row {
  readonly fault: string;
  readonly landed: boolean;
  readonly kind: "成功" | "失败" | "没有终态";
  readonly hasCause: boolean;
  readonly hasNextStep: boolean;
  readonly survivesReload: boolean;
  readonly ms: number;
  readonly note: string;
}
const rows: Row[] = [];

/**
 * 失败时屏幕上必须说清的两件事。
 *
 * ⚠ 这两组词**不是**「只要出现就算过」的护身符：它们后面跟着
 * `expect(...).toBe(true)` 的是**逐条**判据，而且 `rawCode` 那一条是反向的——
 * 内部错误码上屏一律不算「说清了成因」。
 */
const CAUSE_WORDS = /失败|没能|出错|未完成|中断|超时|不可用|空/;
const NEXT_STEP_WORDS = /下一步|再试|重试|检查|稍后|换|联系|刷新/;
/** 内部错误码（`PROVIDER_TIMEOUT` 这种）不是人话，出现即判「成因没说清」。 */
const RAW_CODE = /[A-Z][A-Z0-9]{2,}_[A-Z]/;

async function freshThread(page: Page): Promise<string> {
  await ensureAuthedPageOrigin(page);
  const threadId = await openAuthoritativeFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  return threadId;
}

/**
 * 这一刻用户「拿到结果」了吗。
 *
 * ⚠ 判据改过一次，原因值得留下：第一版用
 * `copilot-assistant-message` 的**最后一个**气泡取正文，结果六格里四格读到「0 字」，
 * 而屏幕上明明写着答案（「其中一份文档没能读到，我用能读到的那份作答」）。
 * 最后一个气泡是空的，真正的答案在前面那个。于是我把「有答案」误判成「没答案」，
 * 又据此把成功的格子记成失败、给它扣「没有下一步」的分——**一条错误的判据会连锁
 * 生出一串错误的结论**。
 *
 * 现在：答案 = **所有**气泡文本拼起来；失败面 = `copilotkit-v2-error` 这个权威锚点，
 * 不靠文案猜。两者有其一即「拿到结果」。
 */
async function readScreen(page: Page): Promise<{
  answer: string; hasArtifact: boolean; hasFailureSurface: boolean; screen: string;
}> {
  const bubbles = await page.getByTestId("copilot-assistant-message").allTextContents();
  const hasArtifact = await page
    .locator('[data-testid="chat-canvas-fabric"], [data-testid="chat-produced-files-inline"]')
    .count() > 0;
  const hasFailureSurface = await page.getByTestId("copilotkit-v2-error").count() > 0;
  const screen = ((await page.locator("main").innerText().catch(() => "")) ?? "").trim();
  return { answer: bubbles.join("").trim(), hasArtifact, hasFailureSurface, screen };
}

/** 轮询到「拿到结果」为止（正文/产物/失败面三者其一），或等满预算。 */
async function awaitLanding(page: Page, budgetMs: number): Promise<Awaited<ReturnType<typeof readScreen>>> {
  const deadline = Date.now() + budgetMs;
  let last = await readScreen(page);
  while (Date.now() < deadline) {
    if (last.answer.length > 0 || last.hasArtifact || last.hasFailureSurface) return last;
    await page.waitForTimeout(500);
    last = await readScreen(page);
  }
  return last;
}

async function probe(page: Page, fault: string, trigger: string): Promise<void> {
  const started = Date.now();
  const threadId = await freshThread(page);
  await page.getByTestId("copilotkit-v2-input").fill(trigger);
  await page.getByTestId("copilotkit-v2-send").click();

  // ① 有限时间内必须不再「运行中」。等不到 = 没有终态，用户还在转圈。
  let landed = true;
  try {
    await expect(page.getByTestId("copilotkit-v2-running-indicator"))
      .toHaveCount(0, { timeout: LANDING_BUDGET_MS });
  } catch {
    landed = false;
  }

  // 终态落定后，正文/产物/失败面可能晚几帧才进 DOM——轮询，不是读一次。
  const after = await awaitLanding(page, 15_000);
  const gotResult = after.answer.length > 0 || after.hasArtifact || after.hasFailureSurface;
  const kind: Row["kind"] = !landed ? "没有终态"
    : after.hasFailureSurface ? "失败" : gotResult ? "成功" : "没有终态";

  // 失败时必须说清成因与下一步；成功时这两项不适用（记 true 不影响判定）。
  const hasCause = kind === "失败"
    ? CAUSE_WORDS.test(after.screen) && !RAW_CODE.test(after.screen) : true;
  const hasNextStep = kind === "失败" ? NEXT_STEP_WORDS.test(after.screen) : true;

  // 刷新后结果仍在——只活在内存里的结果，用户切走再回来就没了。
  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible({ timeout: 120_000 });
  const reloaded = await awaitLanding(page, 30_000);
  const survivesReload = kind === "没有终态" ? false
    : kind === "失败"
      ? reloaded.hasFailureSurface || CAUSE_WORDS.test(reloaded.screen)
      : reloaded.answer.length > 0 || reloaded.hasArtifact;

  rows.push({
    fault, landed, kind, hasCause, hasNextStep, survivesReload,
    ms: Date.now() - started,
    /*
     * 备注里必须带**屏幕上的原话摘要**。第一版只记字数，于是拿到 ❌ 之后分不出
     * 「产品真的没说下一步」还是「我的判据没认出它说的那句话」——两者修法完全不同。
     */
    note: `答案 ${String(after.answer.length)} 字 / 失败面=${String(after.hasFailureSurface)}`
      + `；屏尾「${after.screen.slice(-80).replace(/\s+/g, " ")}」`,
  });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

test("不变量：每一次运行，用户都拿得到结果", async ({ page }) => {
  await openChatEmptyState(page);
  await warmUpCopilotRuntimeRoute(page);

  await probe(page, "基线 · 正常多步", CHAT_READ_E2E.deepAgentMultiStepTrigger);
  await probe(page, "run 失败", CHAT_READ_E2E.deepAgentFailureTrigger);
  await probe(page, "工具失败", CHAT_READ_E2E.deepAgentToolFailureTrigger);
  await probe(page, "流式中断", CHAT_READ_E2E.deepAgentStreamAbortTrigger);
  await probe(page, "空手而归", CHAT_READ_E2E.deepAgentEmptyReplyTrigger);
  await probe(page, "长静默", CHAT_READ_E2E.deepAgentSlowTrigger);

  const lines = [
    "# 不变量：用户 100% 拿得到结果",
    "",
    "每一次运行都必须落到终态；失败也是结果，但要说清**为什么**和**下一步**。",
    `预算 ${String(LANDING_BUDGET_MS / 1000)}s；超时即「没有终态」（就是「一直转圈」）。`,
    "⚠ 本表**不要求这一轮成功**——注入了故障的格子，成功反而可疑。",
    "",
    "| 注入的故障 | 终态 | 有成因 | 有下一步 | 刷新后仍在 | 耗时 | 备注 |",
    "|---|---|---|---|---|---|---|",
  ];
  const tick = (ok: boolean): string => (ok ? "✅" : "❌");
  for (const r of rows) {
    lines.push(`| ${r.fault} | ${r.kind === "没有终态" ? "❌ 没有终态" : r.kind} | ${tick(r.hasCause)} | `
      + `${tick(r.hasNextStep)} | ${tick(r.survivesReload)} | ${String(Math.round(r.ms / 1000))}s | ${r.note} |`);
  }
  const broken = rows.filter((r) => !r.landed || !r.hasCause || !r.hasNextStep || !r.survivesReload);
  lines.splice(2, 0,
    `**${String(rows.length - broken.length)} / ${String(rows.length)} 格完全满足不变量**`, "");
  const report = lines.join("\n");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${report}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`\n${report}\n`);

  expect(broken.map((r) => `${r.fault}：终态=${r.kind} 成因=${String(r.hasCause)} `
    + `下一步=${String(r.hasNextStep)} 刷新后=${String(r.survivesReload)}`), "有格子没满足不变量").toEqual([]);
});
