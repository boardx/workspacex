/**
 * 🔴 issue #2094 —— 自动命名与线程卡状态的**纯函数门控**（人类裁决落地，回指 #2068）。
 *
 * ## 为什么这两条值得单独钉，而不是靠 e2e 覆盖
 *
 * 真栈 e2e（`chat-task-workbench-copy.spec.ts` / `-p1-efficiency.spec.ts`）证明的是
 * 「屏幕上不再有 `0 个 agent`」「标题不再是新对话」——**端到端有没有效**。
 * 它证不到的是**边界**：空白正文、emoji 被截断劈半、run 状态漂移。那些在真栈上
 * 既难构造又慢，但恰恰是这个功能会出错的地方。
 *
 * ⚠ 本文件**不重复** e2e 已经证明的东西。两处证同一件事就是「同一事实声明在两处」。
 */
import { describe, expect, it } from "vitest";
import { AUTO_TITLE_MAX_LENGTH, deriveThreadTitle } from "../../src/domain/chat/thread-title";
import { threadCardStatus } from "../../src/domain/chat/thread-badges";

describe("deriveThreadTitle —— 自动命名（#2094）", () => {
  it("短正文原样成为标题", () => {
    expect(deriveThreadTitle("帮我写一份周报")).toBe("帮我写一份周报");
  });

  it("超长正文按码点截断并加省略号，总长不超过上限", () => {
    const body = "帮我调研一下国内协同白板产品的竞品格局并输出一份对比表";
    const title = deriveThreadTitle(body);
    expect(title).not.toBeNull();
    expect(Array.from(title as string)).toHaveLength(AUTO_TITLE_MAX_LENGTH);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("换行与连续空白折叠成单个空格——侧栏是单行，标题里不许藏看不见的字符", () => {
    expect(deriveThreadTitle("  第一行\n\n第二行\t第三行  ")).toBe("第一行 第二行 第三行");
  });

  /**
   * 反证面：按 UTF-16 code unit 截断会把代理对劈成两半，产出乱码标题。
   * 这条用 emoji 卡在截断点上，`slice` 实现会红，`Array.from` 实现会绿。
   */
  it("按码点而非 code unit 截断——emoji 不会被劈成半个", () => {
    const body = "🎉".repeat(AUTO_TITLE_MAX_LENGTH + 5);
    const title = deriveThreadTitle(body) as string;
    expect(title).not.toBeNull();
    // 劈开代理对会产生 U+FFFD 或孤立的高/低位代理。
    expect(title).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(title.replace("…", "")).toBe("🎉".repeat(AUTO_TITLE_MAX_LENGTH - 1));
  });

  /**
   * 空线程那条设计决定的落点：**没有输入就不起名**，返回 `null` 让调用方留着
   * 「新对话」。返回空串会写进 `title` 列，产出一张没有标题的卡片——
   * 那比「新对话」更糟：用户看不出是没起名还是起名失败。
   */
  it("正文全是空白 ⇒ 返回 null，不编一个标题", () => {
    expect(deriveThreadTitle("")).toBeNull();
    expect(deriveThreadTitle("   \n\t  ")).toBeNull();
  });
});

describe("threadCardStatus —— 线程卡状态（#2094）", () => {
  it("一条消息都没有 ⇒ not-started（devapp 实测 58 条里 36 条如此）", () => {
    expect(threadCardStatus({ hasMessages: false, latestRunStatus: null })).toBe("not-started");
  });

  /**
   * 反证面：`not-started` 优先于任何 run 状态。没有可见消息却因为存在一条
   * `succeeded` 的 run 而显示「已完成」，就是拿用户看不见的东西下结论。
   */
  it("没有可见消息时，即便有 run 也仍是 not-started", () => {
    expect(threadCardStatus({ hasMessages: false, latestRunStatus: "succeeded" }))
      .toBe("not-started");
  });

  it("有消息、从没跑过 run ⇒ done", () => {
    expect(threadCardStatus({ hasMessages: true, latestRunStatus: null })).toBe("done");
  });

  it.each([
    ["queued", "running"],
    ["running", "running"],
    ["writeback_pending", "running"],
    ["awaiting_approval", "awaiting-approval"],
    ["failed", "failed"],
    ["succeeded", "done"],
  ] as const)("最近 run %s ⇒ %s", (runStatus, expected) => {
    expect(threadCardStatus({ hasMessages: true, latestRunStatus: runStatus })).toBe(expected);
  });
});
