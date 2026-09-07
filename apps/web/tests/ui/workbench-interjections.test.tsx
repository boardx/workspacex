import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
    rerender(<RunInterjections events={[{ ...received, status: "not_applied" }]} />);
    expect(screen.getByTestId("workbench-interjection-status")).toHaveTextContent("本轮未应用");
  });
});
