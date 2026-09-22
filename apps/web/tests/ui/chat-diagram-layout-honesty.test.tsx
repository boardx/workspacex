/**
 * issue #3642 · 反证：**挪动节点后保存不得回成功态**。
 *
 * 手册任务 17/18 实测：在全屏画布里挪一个方框 → 点「保存」→ 界面写
 * 「已保存 · 05:05:52」并弹出「已落成 canvas artifact」→ 刷新后方框回原位。
 * 根因是持久化形式（mermaid 源码，D-08 / R7 ②）里没有坐标位，几何改动在保存那一刻
 * 必然丢失；缺陷不在那条设计，在于界面**对此只字不提、反而回成功态**。
 *
 * 修复前跑本文件：`ChatDiagramCanvasModal` 根本收不到「用户挪过框」这个信号
 * （它只拿得到 markdown，而只挪位置时 markdown 逐字不变），于是点保存照常亮
 * 「已保存」徽标——下面每一条都红。
 *
 * 真实 fabric 画布 jsdom 建不出（同 `chat-diagram-saved-readback.test.tsx` 头注），
 * `CanvasStage` 换成探针：它把 `onGeometryDriftChange` 暴露成两个按钮，模拟
 * 「拖了 N 个节点」与「重新加载后漂移归零」。探针只替真实 CanvasStage 发同样的信号，
 * 不替 modal 做任何判断——被测的是 modal 怎么用这个信号。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { landAsArtifact } = vi.hoisted(() => ({ landAsArtifact: vi.fn() }));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  landAsArtifact,
}));

vi.mock("@/components/canvas/canvas-stage", () => ({
  CanvasStage: React.forwardRef(function CanvasStageProbe(
    props: {
      markdown: string;
      onMarkdownChange: (next: string) => void;
      onGeometryDriftChange?: (moved: readonly string[]) => void;
    },
    _ref,
  ) {
    return (
      <div>
        <pre data-testid="canvas-stage-probe">{props.markdown}</pre>
        {/* 拖动两个节点：几何变了，markdown 逐字不变（坐标写不进 mermaid 源）。 */}
        <button
          data-testid="probe-drag-nodes"
          onClick={() => props.onGeometryDriftChange?.(["A", "C"])}
        >
          drag
        </button>
        {/* 在拖动之外再改一处结构：markdown 真的变了。 */}
        <button
          data-testid="probe-edit-label"
          onClick={() => props.onMarkdownChange("```mermaid\nflowchart TB\n    A[\"张三（CTO）\"]\n    B[\"李四（改过的标签）\"]\n    A --> B\n```")}
        >
          relabel
        </button>
        {/* 重新加载（撤销到底 / 切版本 / 源码手改）后漂移归零。 */}
        <button
          data-testid="probe-reload"
          onClick={() => props.onGeometryDriftChange?.([])}
        >
          reload
        </button>
      </div>
    );
  }),
}));

import { ChatDiagramCanvasModal } from "@/components/chat/chat-diagram-canvas-modal";

const ORG_CHART = 'flowchart TB\n    A["张三（CTO）"]\n    B["李四（前端组组长）"]\n    A --> B';

function renderModal() {
  return render(
    <ChatDiagramCanvasModal code={ORG_CHART} onClose={() => {}} threadId="t" messageId="m-1" bearer="b" />,
  );
}

describe("issue #3642 · 挪动节点后保存不得假报成功", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    landAsArtifact.mockResolvedValue({ artifactId: "art-829af8ee" });
  });

  it("挪过节点 ⇒ 当场出现「位置改动保存不了」提示条（不等用户刷新才发现）", () => {
    renderModal();
    expect(screen.queryByTestId("chat-diagram-layout-unsavable")).toBeNull();

    fireEvent.click(screen.getByTestId("probe-drag-nodes"));
    expect(screen.getByTestId("chat-diagram-layout-unsavable").textContent).toContain("位置改动保存不了");
  });

  it("只挪了位置就点保存 ⇒ 拦下并说明，不出现「已保存」徽标，也不打落库请求", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("probe-drag-nodes"));
    fireEvent.click(screen.getByTestId("chat-diagram-save"));

    await waitFor(() => expect(screen.getByTestId("chat-diagram-layout-blocked")).toBeTruthy());
    // 这条是整个 issue 的判据：界面不得回成功态。
    expect(screen.queryByTestId("chat-diagram-saved")).toBeNull();
    // 落库的 mermaid 源与上一版逐字相同 ⇒ 那次请求本来就什么都存不了，不该发出去。
    expect(landAsArtifact).not.toHaveBeenCalled();
  });

  it("拦截条给出「仍要保存结构」出口；越过后徽标如实写明不含位置改动", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("probe-drag-nodes"));
    fireEvent.click(screen.getByTestId("chat-diagram-save"));
    await waitFor(() => expect(screen.getByTestId("chat-diagram-layout-blocked")).toBeTruthy());

    fireEvent.click(screen.getByTestId("chat-diagram-save-structure-anyway"));
    await waitFor(() => expect(screen.getByTestId("chat-diagram-saved")).toBeTruthy());
    expect(landAsArtifact).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chat-diagram-saved").textContent).toContain("不含位置改动");
    expect(screen.getByTestId("chat-diagram-saved-without-layout").textContent).toContain("没有坐标位");
  });

  it("挪了位置 + 改了结构 ⇒ 照常保存（结构不受连累），但徽标写明位置没存", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("probe-drag-nodes"));
    fireEvent.click(screen.getByTestId("probe-edit-label"));
    fireEvent.click(screen.getByTestId("chat-diagram-save"));

    await waitFor(() => expect(screen.getByTestId("chat-diagram-saved")).toBeTruthy());
    expect(screen.queryByTestId("chat-diagram-layout-blocked")).toBeNull();
    expect(landAsArtifact).toHaveBeenCalledTimes(1);
    expect(landAsArtifact.mock.calls[0]![1].payloadRef).toContain("李四（改过的标签）");
    expect(screen.getByTestId("chat-diagram-saved").textContent).toContain("不含位置改动");
  });

  it("重新加载后漂移归零 ⇒ 提示条消失，保存回归既有行为（不误伤没挪过框的保存）", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("probe-drag-nodes"));
    expect(screen.getByTestId("chat-diagram-layout-unsavable")).toBeTruthy();

    fireEvent.click(screen.getByTestId("probe-reload"));
    expect(screen.queryByTestId("chat-diagram-layout-unsavable")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-diagram-save"));
    await waitFor(() => expect(screen.getByTestId("chat-diagram-saved")).toBeTruthy());
    expect(screen.getByTestId("chat-diagram-saved").textContent).not.toContain("不含位置改动");
    expect(landAsArtifact).toHaveBeenCalledTimes(1);
  });
});
