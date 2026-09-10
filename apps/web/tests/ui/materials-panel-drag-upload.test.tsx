import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/live-chat", async (original) => ({
  ...await original<typeof import("@/lib/live-chat")>(),
  uploadAttachment: upload,
}));

import { useChatAttachments, type ChatMaterialsUploadPort } from "@/components/chat/chat-composer-attachments";
import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";

/**
 * issue #3347 —— 右栏「材料」页签的上传入口（点击 + 拖拽）。
 *
 * ## 断言落在哪（以及**刻意不**落在哪）
 *
 * 判据是「**那个文件真的被交给了真实上传函数、真的进了随下一条消息发出的 pending
 * 队列**」——不是「drop 事件被触发了」，也不是「出现了高亮边框」。后两者在功能坏掉
 * 时无法被证伪：把 `attachUploadPort` 换回 `null`（也就是本 issue 之前 main 上的
 * 样子），拖拽高亮和事件回调照样可以存在，而文件哪都没去。本文件的每一条都会因为
 * 那一改动变红——反证记录见 PR 正文。
 *
 * ## 为什么在 jsdom 这一层也要有
 * 真浏览器那条（`copilotkit-v2-materials-drop-upload.spec.ts`，走真实 multipart →
 * `chat_message_attachments` → 材料列表）跑在 `chat-read` 车道上，而那条车道
 * **在 PR 上永不执行**（`harness-verify.yml` 的 `if: github.event_name != 'pull_request'`）。
 * 只有这一层是每个 PR 都会跑的，所以链路的"前半段"（drop → 真实上传调用 → pending
 * 队列）必须在这里被钉住，不能全押在一条 PR 上不跑的车道上。
 */

const flushed = { current: null as ChatMaterialsUploadPort | null };

/**
 * 外壳的桥接在这里被**如实复现**（面板 `useChatAttachments` → 上报窄面 → 外壳
 * state → `ChatTaskInspector`）。刻意不在测试里另建控制器直接塞给 Inspector：
 * 那样测的就不是真实装配，而是一个只在测试里存在的接线。
 */
function Harness({ canWrite = true }: { canWrite?: boolean }) {
  const attach = useChatAttachments({ threadId: "thread-1", bearer: "bearer", canWrite });
  const port = React.useMemo<ChatMaterialsUploadPort>(
    () => ({ pickFiles: attach.pickFiles, banner: attach.banner }),
    [attach.pickFiles, attach.banner],
  );
  flushed.current = port;
  return (
    <ChatTaskInspector
      hasSelection
      threadId="thread-1"
      projectId={null}
      artifacts={{ items: [] }}
      materials={{ items: [] }}
      loading={false}
      artifactsError={null}
      materialsError={null}
      onRetry={() => {}}
      pendingMaterialsCount={attach.uploadedIds.length}
      planTodos={null}
      isRunning={false}
      runPhaseLabel={null}
      runStartedAt={null}
      attachUploadPort={port}
      uploadDisabledReason={canWrite ? null : "当前对话只读或写权限尚未确认，不能上传文件"}
    />
  );
}

function dropOnInspector(files: File[]): void {
  const inspector = screen.getByTestId("chat-task-workbench-inspector");
  fireEvent.dragEnter(inspector, { dataTransfer: { files, types: files.length > 0 ? ["Files"] : ["text/plain"] } });
  fireEvent.dragOver(inspector, { dataTransfer: { files, types: files.length > 0 ? ["Files"] : ["text/plain"] } });
  fireEvent.drop(inspector, { dataTransfer: { files, types: files.length > 0 ? ["Files"] : ["text/plain"] } });
}

beforeEach(() => {
  upload.mockReset();
  flushed.current = null;
});

describe("issue #3347 右栏「材料」上传入口", () => {
  it("拖文件到右栏：文件真的进了同一条 pending 队列，并把结果显示出来", async () => {
    upload.mockResolvedValue({ id: "server-att-1", bytes: 5, mime: "text/plain" });
    const file = new File(["hello"], "dropped.txt", { type: "text/plain" });
    render(<Harness />);

    dropOnInspector([file]);

    // ① 那个文件真的被交给了真实上传函数（同一条 composer 上传路径，同一条线程）。
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]![0]).toBe("thread-1");
    expect((upload.mock.calls[0]![1] as File).name).toBe("dropped.txt");

    // ② 落在右栏任意位置都算数：自动切到「材料」页签，把结果亮出来。
    await waitFor(() => expect(
      screen.getByTestId("chat-task-workbench-inspector").getAttribute("data-active-tab"),
    ).toBe("materials"));

    // ③ 「真的完成了上传并出现在列表里」这一半：pending 计数来自控制器的
    //    `uploadedIds`（只有服务端真的回了 id 才会 +1），不是"我发过一次请求"。
    await waitFor(() => expect(screen.getByTestId("chat-materials-pending-count")).toHaveTextContent("1 个"));

    // ④ 上传入口本身存在且可点（#3347 之前这里是 `uploadCtl={null}`，两者都不存在）。
    expect(screen.getByTestId("chat-materials-upload-trigger")).toBeEnabled();
    expect(screen.getByTestId("chat-materials-upload-input")).toBeInTheDocument();
  });

  it("点击入口选文件：与拖拽同一条路径", async () => {
    upload.mockResolvedValue({ id: "server-att-2", bytes: 3, mime: "text/plain" });
    render(<Harness />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-tab-materials"));
    fireEvent.change(screen.getByTestId("chat-materials-upload-input"), {
      target: { files: [new File(["abc"], "picked.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect((upload.mock.calls[0]![1] as File).name).toBe("picked.txt");
  });

  it("拖的不是文件（纯文本 / 链接 / 文件夹）：明确说明，不静默", async () => {
    render(<Harness />);
    dropOnInspector([]);
    await waitFor(() => expect(screen.getByTestId("chat-materials-upload-notice")).toBeInTheDocument());
    expect(screen.getByTestId("chat-materials-upload-notice")).toHaveTextContent("只支持拖入文件");
    expect(upload).not.toHaveBeenCalled();
  });

  it("超过单文件上限：拒绝理由显示在材料页签里，不是只在 composer 那边闷着", async () => {
    render(<Harness />);
    const huge = new File(["x"], "huge.txt", { type: "text/plain" });
    Object.defineProperty(huge, "size", { value: 26 * 1024 * 1024 });
    dropOnInspector([huge]);
    await waitFor(() => expect(screen.getByTestId("chat-materials-upload-error")).toHaveTextContent("huge.txt"));
    expect(upload).not.toHaveBeenCalled();
  });

  it("只读会话：入口渲染但禁用并写出理由——不是悄悄消失，也不接受拖拽", async () => {
    render(<Harness canWrite={false} />);
    fireEvent.click(screen.getByTestId("chat-task-workbench-inspector-tab-materials"));
    expect(screen.getByTestId("chat-materials-upload-trigger")).toBeDisabled();
    expect(screen.getByTestId("chat-materials-upload-hint"))
      .toHaveTextContent("当前对话只读或写权限尚未确认");
    dropOnInspector([new File(["x"], "denied.txt", { type: "text/plain" })]);
    await waitFor(() => expect(screen.getByTestId("chat-materials-upload-notice"))
      .toHaveTextContent("当前对话只读或写权限尚未确认"));
    expect(upload).not.toHaveBeenCalled();
  });
});
