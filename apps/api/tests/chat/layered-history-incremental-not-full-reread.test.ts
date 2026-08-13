/**
 * F154 L2（08-chat/uc-8-7 R12 V2）—— `planLayeredHistoryIncrement` 纯函数反证：
 * 「只对 L1 边界之前、尚未纳入摘要的新增区间做增量，不重读全史」。
 *
 * 纯应用逻辑，零 IO：同 `trim-history-to-budget.test.ts`/`assemble-history.test.ts` 的纪律，
 * 手造 `ThreadHistoryMessage[]`（含 id），不接数据库/模型。真库端到端反证（含 upsert 真的落库、
 * summarize 调用真的只喂增量）在 `layered-history-l2-persist.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { planLayeredHistoryIncrement } from "../../src/application/agent-run/execute-run";
import type { ThreadHistoryMessage } from "../../src/application/agent-run/ports";

const msg = (id: string, role: ThreadHistoryMessage["role"], content: string): ThreadHistoryMessage =>
  ({ id, role, content });

describe("planLayeredHistoryIncrement", () => {
  it("从未摘要过（summarizedThroughId=null）→ L1 边界之前的全部候选都是新增", () => {
    const candidates = [msg("m1", "user", "a"), msg("m2", "assistant", "b"), msg("m3", "user", "c")];
    const l1 = [msg("m3", "user", "c")]; // 只有最新一条留在 L1
    const plan = planLayeredHistoryIncrement(candidates, l1, null);
    expect(plan.toSummarize).toEqual([msg("m1", "user", "a"), msg("m2", "assistant", "b")]);
    expect(plan.advanceCursorTo).toBe("m2");
  });

  it("游标已推进到某条 → 只取游标之后、L1 边界之前的部分（不重读游标之前的）", () => {
    const candidates = [
      msg("m1", "user", "a"), msg("m2", "assistant", "b"),
      msg("m3", "user", "c"), msg("m4", "assistant", "d"), msg("m5", "user", "e"),
    ];
    const l1 = [msg("m5", "user", "e")];
    const plan = planLayeredHistoryIncrement(candidates, l1, "m2");
    // m1/m2 已经被上次摘要覆盖过——即使它们还在候选集里，这次也不该再喂给摘要调用。
    expect(plan.toSummarize).toEqual([msg("m3", "user", "c"), msg("m4", "assistant", "d")]);
    expect(plan.advanceCursorTo).toBe("m4");
  });

  it("游标已经追到 L1 边界（没有新增区间）→ 空 increment，不发起摘要调用", () => {
    const candidates = [msg("m1", "user", "a"), msg("m2", "assistant", "b"), msg("m3", "user", "c")];
    const l1 = [msg("m2", "assistant", "b"), msg("m3", "user", "c")];
    // 游标已经推到 m1（L1 边界之前唯一的一条），没有更旧的新增了。
    const plan = planLayeredHistoryIncrement(candidates, l1, "m1");
    expect(plan.toSummarize).toEqual([]);
    expect(plan.advanceCursorTo).toBeNull();
  });

  it("L1 覆盖了全部候选（短线程）→ 没有 L1 边界之前的内容，空 increment", () => {
    const candidates = [msg("m1", "user", "a"), msg("m2", "assistant", "b")];
    const l1 = candidates; // 全部都在 L1 里，字符预算够
    const plan = planLayeredHistoryIncrement(candidates, l1, null);
    expect(plan.toSummarize).toEqual([]);
    expect(plan.advanceCursorTo).toBeNull();
  });

  it("游标指向一条已经不在候选集里的更旧消息（比 L2_CATCHUP_FETCH_LIMIT 覆盖的还旧）→ 从候选集最旧的开始，不报错", () => {
    const candidates = [msg("m50", "user", "x"), msg("m51", "assistant", "y"), msg("m52", "user", "z")];
    const l1 = [msg("m52", "user", "z")];
    // m1 是游标，但候选集（宽窗口）里已经看不到它了——有界降级，不是 bug。
    const plan = planLayeredHistoryIncrement(candidates, l1, "m1");
    expect(plan.toSummarize).toEqual([msg("m50", "user", "x"), msg("m51", "assistant", "y")]);
    expect(plan.advanceCursorTo).toBe("m51");
  });

  it("候选集里任意一条缺 id（测试 fake 不关心持久化）→ 保守跳过，不猜测顺序", () => {
    const candidates: ThreadHistoryMessage[] = [
      { role: "user", content: "no id here" }, // 缺 id
      msg("m2", "assistant", "b"),
      msg("m3", "user", "c"),
    ];
    const l1 = [msg("m3", "user", "c")];
    const plan = planLayeredHistoryIncrement(candidates, l1, null);
    expect(plan.toSummarize).toEqual([]);
    expect(plan.advanceCursorTo).toBeNull();
  });

  it("空候选集 → 空 increment", () => {
    const plan = planLayeredHistoryIncrement([], [], null);
    expect(plan.toSummarize).toEqual([]);
    expect(plan.advanceCursorTo).toBeNull();
  });
});
