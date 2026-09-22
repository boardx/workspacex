/**
 * issue #3022 ② —— v2 composer 的 `<textarea>` 没有可及名（aria-label）。
 *
 * ## 这个测试要钉住的那件事
 *
 * 真栈探针（2026-09-08，SHA `94f6dda03`）读到的就是：
 *
 * ```
 * PROBE_COMPOSER {"ariaLabel":null,"placeholder":"输入任务目标，Shift+Enter 换行，Enter 发送","id":"","rows":3}
 * PROBE_ROLE_TEXTBOX_消息内容=0
 * ```
 *
 * 没有 `aria-label`、也没有关联的 `<label>` 时，可及名只能回落到 `placeholder`；而这个
 * placeholder 会随状态在三句话之间变（常态 / 运行中 / 归档）——屏幕阅读器读到的**控件名
 * 会跟着状态变**，这既是"placeholder 当 label"这个公认反模式，也让
 * `getByRole("textbox", { name: "消息内容" })` 在 v2 上匹配到 0 个元素
 * （`chat-read` 24 红里 9 条的直接触发点）。
 *
 * ## 为什么断言的是可及名，不是"有没有 aria-label 这个属性"
 *
 * 断言 `toHaveAttribute("aria-label", "消息内容")` 只证明属性写对了，证明不了**用户
 * （屏幕阅读器）听到的名字**是这个——`aria-labelledby`、包裹的 `<label>`、甚至一个
 * `title` 都会参与同一场计算。所以这里一律走 `getByRole("textbox", { name })`，
 * 与旧屏 `chat-read-screen.test.tsx` 逐字同一种取法、同一个名字："消息内容"。
 *
 * 两条钉子：
 * ① 常态下按可及名能取到 composer，且取到的就是 `copilotkit-v2-input` 本体。
 * ② 归档态 placeholder 换成另一句话，可及名**不跟着变**——这条才是"名字稳定"的判据；
 *    只有 ① 的话，实现把 placeholder 写成"消息内容"也能绿。
 *
 * ⚠ 自增高（issue #3022 ①）已由 PR #3045 落地（`rows={1}` + `syncComposerHeight`），
 *   不在本文件范围内。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/** 见 `copilotkit-v2-composer-recording-scroll.test.tsx` 同一段头注：vitest 管线不吃框架的 CSS 副作用导入。 */
const copilotkitV2CssPath = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(copilotkitV2CssPath, () => ({}));

const { listMessages } = vi.hoisted(() => ({
  listMessages: vi.fn(
    async (): Promise<import("@/lib/live-chat").ListMessagesOut> => ({ messages: [], nextCursor: null }),
  ),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listMessages,
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { sessionToken: "b", userId: "u", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  }),
}));
/** 语音输入是既有能力（DA-19g），本测试不驱动真实采音管线，只要 hook 形状对得上。 */
vi.mock("@/lib/use-asr-draft", () => ({
  appendTranscript: (base: string, addition: string) => (addition === "" ? base : base === "" ? addition : `${base} ${addition}`),
  useAsrDraft: () => ({
    status: "idle", listening: false, connecting: false, stopping: false, error: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
    elapsedSeconds: 0, level: 0,
    baseText: "", committedText: "", partialText: "",
  }),
}));
vi.mock("@/lib/use-audio-input-devices", () => ({
  useAudioInputDevices: () => ({ devices: [], selectedDeviceId: null, select: vi.fn() }),
}));
/** skill 挂载栏（#2020）与本 issue 无关，且它自己会发三条真实请求。 */
vi.mock("@/components/chat/chat-skill-mount-panel", () => ({
  ChatSkillMountPanel: () => null,
}));
/** fabric 建 canvas 在 jsdom 里产不出——同 `chat-diagram-save-gate.test.tsx` 的既有限制。 */
vi.mock("@/components/chat/chat-diagram-fabric", () => ({
  ChatDiagramFabric: () => null,
}));

import { CopilotKit } from "@copilotkit/react-core/v2";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

/** 旧屏 `chat-live-message-panel.tsx` 用的就是这个名字；迁移过来的 e2e 断言直接用回它。 */
const COMPOSER_ACCESSIBLE_NAME = "消息内容";

function mount(props: { archived?: boolean } = {}) {
  return render(
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotKitV2AgentSelectionProvider>
        <CopilotKitV2Panel
          chatThreadId="thr-3022"
          archived={props.archived ?? false}
          canGeneratePersona={false}
        />
      </CopilotKitV2AgentSelectionProvider>
    </CopilotKit>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "b");
});

describe("v2 composer 的可及名（issue #3022 ②）", () => {
  it("①常态：按可及名「消息内容」取得到 composer，且就是 `copilotkit-v2-input` 本体", async () => {
    mount();
    const input = await waitFor(() => screen.getByTestId("copilotkit-v2-input"));
    expect(screen.getByRole("textbox", { name: COMPOSER_ACCESSIBLE_NAME })).toBe(input);
  });

  it("②归档态：placeholder 换了一句话，可及名不跟着变（名字不是 placeholder 顶上来的）", async () => {
    mount({ archived: true });
    const input = await waitFor(() => screen.getByTestId("copilotkit-v2-input"));
    // 先证明这一态的 placeholder 确实与常态不同——否则②与①在判同一件事。
    expect(input).toHaveAttribute("placeholder", "该对话已归档，不能再发送消息");
    expect(input.getAttribute("placeholder")).not.toBe(COMPOSER_ACCESSIBLE_NAME);
    expect(screen.getByRole("textbox", { name: COMPOSER_ACCESSIBLE_NAME })).toBe(input);
  });
});
