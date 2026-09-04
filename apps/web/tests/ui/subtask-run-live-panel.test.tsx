/**
 * `SubtaskRunLivePanel`（issue #2666）—— 接 `useSubtaskRuns`/`useRetrySubtaskRun` 的胶水层。
 * mock 掉 `lib/chat/use-subtask-runs` 本身（不是 fetch），只验证这层"拿到 query 结果就
 * 渲染 `SubtaskRunPanel`、拿到 mutate 函数就接进 onRetry"的接线，不重复 `SubtaskRunPanel`
 * 自己的渲染断言（那些在 `subtask-run-panel.test.tsx`）。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SubtaskRunLivePanel } from "@/components/chat/subtask-run-live-panel";
import { MOCK_SUBTASK_RUNS } from "@/lib/mock/subtask-run";

const mutate = vi.fn();
let queryData: unknown = undefined;
let mutationVariables: string | undefined;
let mutationPending = false;

vi.mock("@/lib/chat/use-subtask-runs", () => ({
  useSubtaskRuns: () => ({ data: queryData }),
  useRetrySubtaskRun: () => ({ mutate, isPending: mutationPending, variables: mutationVariables }),
}));

describe("SubtaskRunLivePanel -- 轮询数据接进纯展示面板", () => {
  it("parentRunId 为 null 时不渲染任何东西（这条消息没有触发子任务）", () => {
    const { container } = render(<SubtaskRunLivePanel parentRunId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("query 还没返回数据时不渲染面板", () => {
    queryData = undefined;
    const { container } = render(<SubtaskRunLivePanel parentRunId="run-mock-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("拿到子任务数据后渲染面板，重试按钮触发 mutate(id)", () => {
    queryData = MOCK_SUBTASK_RUNS;
    render(<SubtaskRunLivePanel parentRunId="run-mock-1" />);
    fireEvent.click(screen.getByTestId("chat-subtask-badge"));
    fireEvent.click(screen.getByTestId("chat-subtask-retry"));
    expect(mutate).toHaveBeenCalledWith("subtask-mock-3");
  });
});
