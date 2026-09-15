/**
 * 2026-09-15 人类实测反馈（截图）——「文件在 chat 提交完以后，应该要在 message 上，
 * 而不是在 chat composer 上」。
 *
 * 实测形态：v2 工作台里带附件发出一条消息后，任务已经在推进（进度条在跑），那张附件
 * 卡片仍然留在 composer 里，消息气泡上什么都没有——看起来像"文件根本没发出去"。
 *
 * 两条根因，本用例各钉一条：
 *   ① `attach.clear()` 挂在 `await copilotkit.runAgent(...)` **之后**——整轮 run（几十秒
 *      到几分钟）里附件一直占着 composer。现在在发送那一刻就清。
 *   ② v2 的 `userMessage` slot 从来没接过「消息气泡上的附件」（旧轨道
 *      `chat-live-message-panel.tsx` 早就有），所以清掉之后附件会**彻底消失**。
 *
 * ⚠ 本用例刻意**不**让这一轮 run 成功：jsdom 里 `runAgent` 必然失败。这恰好是最强的
 *   反证形态——附件的去向不能依赖 run 的结果，"已经发出去了"这件事在点下发送那一刻
 *   就已经成立（消息已乐观插入、`attachmentIds` 已随请求发出）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages, getAgentRun, createPersonalThread, uploadAttachment, listCapabilities } = vi.hoisted(() => ({
  listMessages: vi.fn(async () => ({ messages: [], nextCursor: null })),
  getAgentRun: vi.fn(),
  createPersonalThread: vi.fn(async () => ({ threadId: "thr-sent", version: 1 })),
  uploadAttachment: vi.fn(async (_threadId: string, file: File) => ({
    id: `att-${file.name}`, filename: file.name, bytes: file.size,
    mime: file.type, createdAt: "2026-09-15T00:00:00.000Z",
  })),
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

function mount() {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel chatThreadId={null} archived={false} canGeneratePersona={false} />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("v2 工作台：发出去的附件从 composer 移到消息气泡上（2026-09-15 人类实测反馈）", () => {
  it("带附件发送 ⇒ composer 的待发列表立刻清空，同一个文件出现在那条用户消息上", async () => {
    mount();
    const fileInput = await screen.findByTestId("chat-attachment-file-input") as HTMLInputElement;

    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array(64)], "上会材料.pdf", { type: "application/pdf" })] },
    });
    // 先确认它真的处在"待发"状态（上传完成、还在 composer 里）——不然后面"消失了"
    // 证明不了任何事。
    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("chat-attachment-list")).toBeTruthy());
    expect(screen.getByTestId("chat-attachment-list").textContent).toContain("上会材料.pdf");

    fireEvent.change(screen.getByTestId("copilotkit-v2-input"), { target: { value: "请检查" } });
    fireEvent.click(screen.getByTestId("copilotkit-v2-send"));

    // ① composer 的待发列表清空——**同步**断言，点击之后一个 await 都不给：`send()`
    //    在发起 `runAgent` 之前（第一个 `await` 之前）就已经清空。这里如果改成
    //    `waitFor`，jsdom 里那一轮 run 很快就以失败落地，修复前的代码（在 run 之后
    //    才清）也会跟着变绿——那就证明不了"不必等 run 跑完"这件事，而这正是人类实测
    //    看到的形态（任务在推进，文件还挂在输入框上）。
    expect(screen.queryByTestId("chat-attachment-list")).toBeNull();
    // ② 同一个文件出现在消息气泡上（`MessageAttachments`，与旧轨道同一个展示件）。
    const onMessage = await screen.findByTestId("chat-message-attachments");
    expect(onMessage.textContent).toContain("上会材料.pdf");
    expect(screen.getByTestId("chat-message-attachment-att-上会材料.pdf")).toBeTruthy();
    // 这条用户消息本身也在（附件挂的是它，不是飘在消息区外的一块）。
    expect(screen.getByText("请检查")).toBeTruthy();
  });
});
