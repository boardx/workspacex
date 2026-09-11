import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { RunInterjections } from "@/components/chat/workbench/run-interjections";
import { traceEntries } from "@/lib/chat-workbench/run-trace";
describe("durable interjection state", () => {
  it("updates a receipt by identity and never presents receipt as applied or as a tool", () => {
    const received: ExecutionEvent = { runId: "run", seq: 1, emittedAt: "now", kind: "interjection", interjectionId: "id", text: "选A", status: "received" };
    const { rerender } = render(<RunInterjections events={[received]} />);
    expect(screen.getByTestId("workbench-interjection-status")).toHaveAttribute("data-status", "received");
    expect(traceEntries([received])).toEqual([]);
    rerender(<RunInterjections events={[received, { ...received, seq: 2, status: "applied" }]} />);
    expect(screen.getAllByTestId("workbench-interjection-status")).toHaveLength(1);
    expect(screen.getByTestId("workbench-interjection-status")).toHaveTextContent("已应用");
  });

  /*
   * issue #3399 ② —— 「本轮未应用」之后这句话去哪了？
   *
   * 实测链路（`workbench_journal_unapplied_interjections` 触发器 + `PgInterjectionStore.listPublic`）：
   * run 一进终态，没来得及应用的插话就被记一条 `not_applied` 事件，**到此为止**——
   * 不会进下一轮，也没有任何地方再读它。也就是说这句话**根本没有交给助手**，
   * 而用户看到「本轮未应用」会以为它排在队里等下一轮。这是静默丢弃。
   *
   * 判据落在「用户能知道它的去向」上：文案必须说清没被采纳，且必须有一条真的能把
   * 这句话重新发出去的路径——不允许"显示了一句状态、然后什么都没发生"。
   */
  it("tells the user an unapplied interjection was never delivered, and offers a working way to resend it", () => {
    const onResend = vi.fn();
    const unapplied: ExecutionEvent = { runId: "run", seq: 3, emittedAt: "now", kind: "interjection", interjectionId: "id", text: "总结成一个 pdf", status: "not_applied" };
    render(<RunInterjections events={[unapplied]} onResend={onResend} />);
    const status = screen.getByTestId("workbench-interjection-status");
    expect(status).toHaveAttribute("data-status", "not_applied");
    expect(status).toHaveTextContent("未被采纳");
    expect(status).toHaveTextContent("没有收到");
    fireEvent.click(screen.getByTestId("workbench-interjection-resend"));
    expect(onResend).toHaveBeenCalledWith("总结成一个 pdf");
  });

  /*
   * issue #3405（#3399 的治因项）—— 服务端现在真的把它带进下一轮，界面必须说的是
   * 这件**已经发生**的事，而不是继续说「没被采纳」。
   *
   * 「那句话真的进了下一轮的模型输入」由
   * `apps/api/tests/agent-run/interjection-carry-over-real-db.test.ts` ① 钉住——
   * 这里只钉「界面不再把已带入的说成没采纳」，也不再对它提示「重新发送」
   * （提示重发一条已经在跑的指令 = 让用户发两遍）。
   */
  it("says a carried-over interjection is already on its way, and stops offering a resend", () => {
    const onResend = vi.fn();
    const carried: ExecutionEvent = { runId: "run", seq: 3, emittedAt: "now", kind: "interjection", interjectionId: "id", text: "总结成一个 pdf", status: "carried_over" };
    render(<RunInterjections events={[carried]} onResend={onResend} />);
    const status = screen.getByTestId("workbench-interjection-status");
    expect(status).toHaveAttribute("data-status", "carried_over");
    expect(status).toHaveTextContent("带入下一轮");
    expect(status).not.toHaveTextContent("没有收到");
    expect(screen.queryByTestId("workbench-interjection-resend")).toBeNull();
  });
});
