/**
 * `assembleHistory` (V8 / PROP-CHAT-CONTEXT-ENGINE-001 §3) —— 端口内侧的滚动摘要。
 * 纯应用逻辑：summarize 以注入的 fake 提供，无数据库、无 HTTP，纯单测是诚实的证明层
 * （同 trim-history-to-budget.test.ts / execute-run-streaming.test.ts 的纪律）。
 *
 * 核心不变量：**不传 summarize 时，返回值必须与 `trimHistoryToBudget` 逐字节相同**
 * ——这是「默认关、生产零行为变化」的机械保证。
 */
import { describe, expect, it, vi } from "vitest";
import { assembleHistory, trimHistoryToBudget } from "../../src/application/agent-run/execute-run";
import type { ThreadHistoryMessage } from "../../src/application/agent-run/ports";

const msg = (role: ThreadHistoryMessage["role"], content: string): ThreadHistoryMessage =>
  ({ role, content });

describe("assembleHistory", () => {
  it("默认（无 summarize）与 trimHistoryToBudget 逐字节相同 —— 全部放得下", async () => {
    const history = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "how are you")];
    expect(await assembleHistory(history, 1000)).toEqual(trimHistoryToBudget(history, 1000));
  });

  it("默认（无 summarize）与 trimHistoryToBudget 逐字节相同 —— 需要丢弃旧轮", async () => {
    const history = [msg("user", "a".repeat(5)), msg("assistant", "b".repeat(5)), msg("user", "c".repeat(5))];
    expect(await assembleHistory(history, 10)).toEqual(trimHistoryToBudget(history, 10));
    // 且这一路径下 summarize 根本不该被调用（连传都没传）——本用例只证等价，下面证不调用。
  });

  it("开启摘要但没有任何轮被丢弃时，不调用 summarize，返回与默认相同", async () => {
    const history = [msg("user", "hi"), msg("assistant", "hello")];
    const summarize = vi.fn(async () => "SUMMARY");
    const out = await assembleHistory(history, 1000, summarize);
    expect(summarize).not.toHaveBeenCalled();
    expect(out).toEqual(trimHistoryToBudget(history, 1000));
  });

  it("开启摘要且有旧轮被丢弃、且余量容得下摘要时，摘要成一条 assistant 伪消息前置", async () => {
    // 最旧一轮很大（会被预算丢弃），最近几轮很小（保留后仍留有余量给摘要）。
    const history = [
      msg("user", "旧".repeat(200)),  // 会被丢 → 进摘要
      msg("user", "r1"),               // 保留（小）
      msg("user", "r2"),               // 保留（小）
      msg("user", "r3"),               // 保留（小）
    ];
    const summarize = vi.fn(async (dropped: readonly ThreadHistoryMessage[]) => {
      // summarize 拿到的是被丢弃的最旧那一轮
      expect(dropped.map((m) => m.content)).toEqual(["旧".repeat(200)]);
      return "旧事";
    });
    const out = await assembleHistory(history, 20, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(out[0]).toEqual(msg("assistant", "[前 1 轮对话摘要] 旧事"));
    // 最近三轮都还在
    expect(out.map((m) => m.content).filter((c) => c.startsWith("r"))).toEqual(["r1", "r2", "r3"]);
    // 总量不超预算
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(20);
  });

  it("summarize 抛错时静默退回丢弃行为，不抛给调用方（不 fail run）", async () => {
    const history = [msg("user", "x".repeat(20)), msg("user", "y".repeat(5))];
    const summarize = vi.fn(async () => { throw new Error("model down"); });
    const out = await assembleHistory(history, 5, summarize);
    expect(out).toEqual(trimHistoryToBudget(history, 5));
  });

  it("summarize 返回空串时不插伪消息，退回丢弃行为", async () => {
    const history = [msg("user", "x".repeat(20)), msg("user", "y".repeat(5))];
    const out = await assembleHistory(history, 5, async () => "   ");
    expect(out).toEqual(trimHistoryToBudget(history, 5));
  });

  it("摘要挤不下余量时跳过摘要、近几轮原样保留（近几轮永远优先，绝不被摘要挤掉）", async () => {
    // 保留后缀几乎贴满预算，摘要放不下 ⇒ 应当跳过摘要，返回与默认相同的近几轮。
    const history = [
      msg("user", "d".repeat(30)),     // 丢弃 → 会尝试摘要
      msg("assistant", "e".repeat(8)),  // 较旧的保留轮
      msg("user", "f".repeat(8)),       // 最近轮
    ];
    const out = await assembleHistory(history, 16, async () => "z".repeat(30));
    // 摘要放不下 ⇒ 结果与不摘要逐字节相同，近几轮一个不少
    expect(out).toEqual(trimHistoryToBudget(history, 16));
    expect(out.some((m) => m.content === "f".repeat(8))).toBe(true);
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(16);
  });
});
