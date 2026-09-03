/**
 * issue #2520 —— 裸 `/chat`（`chatThreadId === null`）**不再**在挂载时预建"附件专用线程"。
 *
 * 人类本地实测：每打开一次裸 `/chat`，会话列表里就多一条空的「新对话」——前一次预建的
 * 那条永远没被用上。现在只在第一次真的有文件要上传时才 `createPersonalThread`，同一段
 * 对话只建一次，上传请求带的是那次建出来的真实 id。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, uploadAttachment, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-lazy", version: 1 })),
  uploadAttachment: vi.fn(async (threadId: string, file: File) => ({ id: `att-${file.name}`, filename: file.name, bytes: file.size, mime: file.type, threadId })),
  listCapabilities: vi.fn(async () => ({ items: [] })),
}));

vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages, createPersonalThread, uploadAttachment,
}));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));
vi.mock("@/lib/agent-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run")>()),
  getAgentRun,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
vi.mock("@/lib/use-asr-draft", () => ({
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

function mount(chatThreadId: string | null) {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId={chatThreadId} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

function pdf(name: string): File {
  return new File([new Uint8Array(64)], name, { type: "application/pdf" });
}

function selectFiles(files: File[]) {
  const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("copilotkit-v2 裸 /chat 的附件专用线程按需创建（issue #2520）", () => {
  it("挂载 + 等待一轮 ⇒ 零次 createPersonalThread；📎 按钮已登录即可用（不等预建）", async () => {
    mount(null);
    await screen.findByTestId("chat-attachment-file-input");
    await new Promise((r) => setTimeout(r, 50));
    expect(createPersonalThread).not.toHaveBeenCalled();
    const input = screen.getByTestId("chat-attachment-file-input") as HTMLInputElement;
    expect(input.disabled).toBe(false);
  });

  it("第一次选文件 ⇒ 建一次线程，上传带的是建出来的真实 id；再选文件不再建第二条；附件态不因 id 出现而被清空", async () => {
    mount(null);
    await screen.findByTestId("chat-attachment-file-input");

    selectFiles([pdf("a.pdf"), pdf("b.pdf")]);
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
    expect(createPersonalThread).toHaveBeenCalledTimes(1);
    expect(uploadAttachment.mock.calls.map((c) => c[0])).toEqual(["thr-lazy", "thr-lazy"]);
    // 空串 → 真实 id 的过渡不是切线程，刚上传的两个附件必须还在 composer 里。
    await waitFor(() => expect(screen.getByTestId("chat-attachment-count")).toHaveTextContent("2"));

    selectFiles([pdf("c.pdf")]);
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(3));
    expect(createPersonalThread).toHaveBeenCalledTimes(1);
  });

  it("建线程失败 ⇒ 这一批附件如实报错，下一次选文件重新尝试建线程", async () => {
    createPersonalThread.mockRejectedValueOnce(new Error("boom"));
    mount(null);
    await screen.findByTestId("chat-attachment-file-input");
    selectFiles([pdf("a.pdf")]);
    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('[data-status="error"]')).not.toBeNull());
    expect(uploadAttachment).not.toHaveBeenCalled();

    selectFiles([pdf("b.pdf")]);
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    expect(createPersonalThread).toHaveBeenCalledTimes(2);
  });

  it("持久化线程页（chatThreadId 非空）⇒ 直接用 URL 线程承载上传，永远不建新线程（#2046 不变量）", async () => {
    mount("thr-url");
    await screen.findByTestId("chat-attachment-file-input");
    selectFiles([pdf("a.pdf")]);
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    expect(uploadAttachment.mock.calls[0]?.[0]).toBe("thr-url");
    expect(createPersonalThread).not.toHaveBeenCalled();
  });
});
