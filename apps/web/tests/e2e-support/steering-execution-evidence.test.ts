import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { describe, expect, it } from "vitest";
import { findSteeringExecutionViolations } from "@/e2e/support/steering-execution-evidence";

/**
 * issue #3312 —— 新判据的**反证**在这里，不在 e2e 里。
 *
 * 三步反证（造缺陷 → 变红 → 撤掉 → 恢复绿）要真的执行两类缺陷形状：
 * 「插话取消了活跃工具」与「插话另起了一条 run」。在真实 e2e 里造这两种形状需要改产品代码
 * （替身发不出"取消活跃工具"的事件），于是反证只能是一次性的手工操作、跑完就没了。
 * 把判据抽成纯函数后，缺陷形状变成可长期驻留的夹具：**每次 CI 都在重跑这次反证**，
 * 判据哪天被改弱，这里立刻红。
 *
 * ⚠ 本仓已九次「全绿但空转」。下面每一条 `it` 都成对出现：先证健康 journal 绿，
 * 再对**同一份** journal 做最小突变证明它红——只贴绿的那一半不算数。
 */

const RUN = "run-steering-1";
const at = (seq: number) => ({ runId: RUN, seq, emittedAt: new Date(1_700_000_000_000 + seq).toISOString() });
const toolStart = (seq: number, id: string): ExecutionEvent =>
  ({ ...at(seq), kind: "tool_start", toolCallId: id, toolName: "scroll_document", args: {} } as ExecutionEvent);
const toolEnd = (seq: number, id: string, ok = true): ExecutionEvent =>
  ({ ...at(seq), kind: "tool_end", toolCallId: id, toolName: "scroll_document", result: {}, ok } as ExecutionEvent);

const RECEIVED_SEQ = 8;

/**
 * 健康 journal：与 #3312 里那份真实失败 run 的形状逐点对齐——
 * 插话在 seq 8 被接收，之前已有一对工具收尾（旧判据恰恰会抓到**它**并因此恒假），
 * 之后还有两对工具成对完成，终态 succeeded，只有一条 run。
 */
const healthyJournal = (): ExecutionEvent[] => [
  { ...at(0), kind: "status", status: "running" } as ExecutionEvent,
  toolStart(6, "scroll-1"),
  toolEnd(7, "scroll-1"),
  { ...at(RECEIVED_SEQ), kind: "interjection", interjectionId: "ij-1", text: "突出 B 方向", status: "received" } as ExecutionEvent,
  toolStart(9, "scroll-2"),
  toolEnd(10, "scroll-2"),
  toolStart(11, "scroll-3"),
  toolEnd(12, "scroll-3"),
  { ...at(13), kind: "status", status: "succeeded" } as ExecutionEvent,
];

const check = (events: ExecutionEvent[]) =>
  findSteeringExecutionViolations({ events, runId: RUN, receivedSeq: RECEIVED_SEQ });

describe("findSteeringExecutionViolations", () => {
  it("产品行为正确时通过——包括旧判据恒假的那个相位（快照抓到的工具在插话之前就已收尾）", () => {
    expect(check(healthyJournal())).toEqual([]);
  });

  it("旧判据在这个相位下会红，新判据不会——这正是 #3312 要消掉的假红", () => {
    const events = healthyJournal();
    // 旧判据：锚在「快照那一刻在飞的那一件」= scroll-1（seq 6 start / seq 7 end）。
    const oldCriterion = events.some(event =>
      event.kind === "tool_end" && event.toolCallId === "scroll-1" && event.ok && event.seq > RECEIVED_SEQ);
    expect(oldCriterion).toBe(false); // ← 旧判据恒假 ⇒ 旧 spec 在这里红
    expect(check(events)).toEqual([]); // ← 新判据绿
  });

  // ---- 缺陷形状 1：插话取消了活跃工具（悬空，没有 tool_end） ----
  it("插话取消了活跃工具（悬空未收尾）⇒ 红", () => {
    const events = healthyJournal().filter(event =>
      !(event.kind === "tool_end" && event.toolCallId === "scroll-3"));
    const violations = check(events);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("有工具悬空未收尾");
    expect(violations[0]).toContain("scroll-3");
  });

  it("插话让活跃工具以 ok=false 收尾 ⇒ 红", () => {
    const events = healthyJournal().map(event =>
      event.kind === "tool_end" && event.toolCallId === "scroll-3" ? toolEnd(12, "scroll-3", false) : event);
    expect(check(events).join("\n")).toContain("有工具以 ok=false 收尾");
  });

  it("插话取消了整条 run（status=cancelled）⇒ 红", () => {
    const events = [...healthyJournal(), { ...at(14), kind: "status", status: "cancelled" } as ExecutionEvent];
    expect(check(events).join("\n")).toContain("status=cancelled");
  });

  // ---- 缺陷形状 2：插话另起了一条 run ----
  it("插话另起了一条 run ⇒ 红", () => {
    const events = [
      ...healthyJournal(),
      { runId: "run-steering-2", seq: 0, emittedAt: new Date().toISOString(), kind: "status", status: "running" } as ExecutionEvent,
    ];
    expect(check(events).join("\n")).toContain("另起了 run");
  });

  // ---- 缺陷形状 3：插话之后执行整个停住 ----
  it("插话之后再无工具成对完成 ⇒ 红（判据不因去掉旧锚点而变弱）", () => {
    const events = healthyJournal().filter(event =>
      !((event.kind === "tool_start" || event.kind === "tool_end") && event.toolCallId !== "scroll-1"));
    expect(check(events).join("\n")).toContain("插话之后没有任何工具成对完成");
  });
});
