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
});
