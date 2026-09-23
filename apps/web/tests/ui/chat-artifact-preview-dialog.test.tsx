/**
 * issue #2099 —— 钉住"右栏产物列表点了没反应"的修复：`ChatArtifactsPanel` 的条目
 * 现在接受可选 `onOpen`，`ChatArtifactPreviewDialog` 负责取回并只读渲染产物源。
 * 两者按 `copilotkit-v2-shell.tsx`/`chat-read-screen.tsx` 实际的接线方式一起挂载
 * （不是孤立测每个组件），钉住的是"点击真的能看到内容"这条端到端行为。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";

const getThreadArtifactSource = vi.hoisted(() => vi.fn());
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  getThreadArtifactSource,
}));

import { ChatArtifactsPanel } from "@/components/chat/chat-artifacts-panel";
import { ChatArtifactPreviewDialog } from "@/components/chat/chat-artifact-preview-dialog";
import type { ListThreadArtifactsOut } from "@/lib/live-chat";

const ARTIFACTS: ListThreadArtifactsOut = {
  items: [
    {
      artifactId: "art-1", title: "用户画像", mode: "draft", hasSource: false, version: null,
      messageId: "m-1", pinnedBy: null, pinnedAt: null,
    },
    {
      artifactId: "art-2", title: "flowchart", mode: "draft", hasSource: true, version: 2,
      messageId: "m-2", pinnedBy: null, pinnedAt: null,
    },
  ],
};

function Harness() {
  const [open, setOpen] = React.useState<{ artifactId: string; title: string } | null>(null);
  return (
    <>
      <ChatArtifactsPanel
        hasSelection
        artifacts={ARTIFACTS}
        loading={false}
        error={null}
        onRetry={() => {}}
        onOpen={(item) => setOpen({ artifactId: item.artifactId, title: item.title })}
      />
      {open !== null ? (
        <ChatArtifactPreviewDialog
          threadId="thr-1"
          projectId={null}
          artifactId={open.artifactId}
          title={open.title}
          bearer="b"
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("产物列表点击查看（issue #2099）", () => {
  it("点击一条产物 ⇒ 弹出只读预览，展示取回的 markdown 内容", async () => {
    getThreadArtifactSource.mockResolvedValueOnce({
      markdown: "## 用户画像\n\n姓名：张三",
      version: null,
      savedAt: "2026-08-26T00:00:00.000Z",
      savedBy: "u1",
    });
    render(<Harness />);

    /*
     * 2026-09-23 —— 这两行原本就摆在**点击之前**，而且都通过了。那正是 TW-P1-4
     * 的锚点问题本身：`-preview` 挂在列表标题 `<h2>产物预览</h2>` 上，
     * 什么都没预览它也在。判据没变（产物预览要齐），读法变强了：
     * 点开之前不该有预览，点开之后才该有。
     */
    expect(screen.queryByTestId("chat-task-workbench-artifact-preview")).toBeNull();
    // ⚠「来源」这颗锚点仍然挂在列表包裹 div 上（结构性，不证明任何出处存在）。
    // 这轮没修，理由与下一步见 chat-artifacts-panel.tsx 那段注释——不在这里假装它已经实了。
    expect(screen.getByTestId("chat-task-workbench-artifact-sources")).toBeVisible();

    fireEvent.click(screen.getByTestId("chat-artifact-art-1"));
    expect(getThreadArtifactSource).toHaveBeenCalledWith("thr-1", "art-1", null, "b");

    const content = await screen.findByTestId("chat-artifact-preview-content");
    // 预览锚点只在真的渲染出正文之后才出现。
    expect(screen.getByTestId("chat-task-workbench-artifact-preview")).toBeVisible();
    expect(content.querySelector("h2")?.textContent).toContain("用户画像");
    expect(content.textContent).toContain("张三");
  });

  it("取回失败（NOT_VISIBLE）⇒ 原样回显 reasonCode，不糊成一句「加载失败」", async () => {
    const { ApiError } = await import("@/lib/api-client");
    getThreadArtifactSource.mockRejectedValueOnce(new ApiError(404, "NOT_VISIBLE", {}));
    render(<Harness />);

    fireEvent.click(screen.getByTestId("chat-artifact-art-2"));
    const err = await screen.findByTestId("chat-artifact-preview-error");
    expect(err.textContent).toBe("NOT_VISIBLE");
  });

  it("没有 onOpen 时条目保持纯展示，不可点击（既有行为不变）", () => {
    render(
      <ChatArtifactsPanel hasSelection artifacts={ARTIFACTS} loading={false} error={null} onRetry={() => {}} />,
    );
    const item = screen.getByTestId("chat-artifact-art-1");
    expect(item.tagName).toBe("DIV");
  });
});
