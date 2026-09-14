/**
 * issue #3069 ③ —— 身份表消费 relay 的**替换**协议。
 *
 * 后端 `execution-journal-relay.ts` 的回放兜底会先发一帧
 * `CUSTOM assistant_message_replaced` 撤回已流出的 assistant 正文，再以**同一个**气泡 id
 * 重新发一遍落库正文。AG-UI 的 `TEXT_MESSAGE_*` 只有追加语义，所以「撤回」必须由消费端
 * 落实：不把旧那条从 `agent.messages` 里移除，紧随其后的 `TEXT_MESSAGE_START` 会压出
 * 第二条同 id 消息——就是这条协议要消掉的「两条互相矛盾的气泡」。
 *
 * ⚠ 反证：把 `useChatMessageIdentity` 里那段 `AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME`
 * 分支删掉，第一条 `it` 当场红在「应返回移除后的消息列表」。
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import {
  AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
  AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
} from "@repo/contracts/agui-state-events";
import { useChatMessageIdentity } from "@/lib/copilotkit-v2-message-identity";

type Message = { id: string; role: string; content: string };
type CustomFrame = { event: { name: string; value: unknown }; messages: Message[] };
type Subscriber = {
  onCustomEvent?: (frame: CustomFrame) => { messages?: Message[] } | undefined | void;
  onRunFinishedEvent?: (frame: { messages: Message[] }) => { messages?: Message[] } | undefined | void;
  onTextMessageEndEvent?: (frame: { event: { messageId: string }; messages: Message[]; textMessageBuffer: string }) => void;
};

const STREAM_ID = "thread-3069:1:assistant";
const PERSISTED_ID = "chat-message-3069";

function fakeAgent(): {
  agent: AbstractAgent;
  emit: (frame: CustomFrame) => ReturnType<NonNullable<Subscriber["onCustomEvent"]>>;
  finish: (messages: Message[]) => ReturnType<NonNullable<Subscriber["onRunFinishedEvent"]>>;
  endText: (messageId: string, text: string, messages?: Message[]) => void;
} {
  let subscriber: Subscriber | null = null;
  const agent = {
    subscribe: (s: Subscriber) => {
      subscriber = s;
      return { unsubscribe: () => { subscriber = null; } };
    },
  } as unknown as AbstractAgent;
  return {
    agent,
    emit: (frame) => subscriber?.onCustomEvent?.(frame),
    finish: (messages) => subscriber?.onRunFinishedEvent?.({ messages }),
    endText: (messageId, text, messages = []) => subscriber?.onTextMessageEndEvent?.({
      event: { messageId }, messages, textMessageBuffer: text,
    }),
  };
}

describe("useChatMessageIdentity：assistant_message_replaced", () => {
  it("撤回帧把作废气泡从消息列表里移除（以订阅者 mutation 的形式返回）", () => {
    const { agent, emit } = fakeAgent();
    renderHook(() => useChatMessageIdentity(agent));

    const messages: Message[] = [
      { id: "user-1", role: "user", content: "现在几点" },
      { id: STREAM_ID, role: "assistant", content: "已查询当前时间，详情见工具结果。" },
    ];
    let result: { messages?: Message[] } | undefined | void;
    act(() => {
      result = emit({
        event: {
          name: AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
          value: { replacedMessageIds: [STREAM_ID], replacementMessageId: STREAM_ID },
        },
        messages,
      });
    });
    expect(result, "应返回移除后的消息列表").toBeTruthy();
    expect(result!.messages!.map((m) => m.id)).toEqual(["user-1"]);
  });

  it("形状不合契约的撤回帧被丢弃，不猜要撤回哪些气泡", () => {
    const { agent, emit } = fakeAgent();
    renderHook(() => useChatMessageIdentity(agent));
    const messages: Message[] = [{ id: STREAM_ID, role: "assistant", content: "x" }];
    let result: { messages?: Message[] } | undefined | void;
    act(() => {
      // `replacementMessageId` 不在 `replacedMessageIds` 里 —— 契约的 refine 拒绝它。
      result = emit({
        event: {
          name: AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
          value: { replacedMessageIds: [STREAM_ID], replacementMessageId: "someone-else" },
        },
        messages,
      });
    });
    expect(result, "解析失败即丢弃这一帧").toBeFalsy();
  });

  it("替换之后的映射把承载气泡认到真实主键上——落地按钮据此才画得出来", () => {
    const { agent, emit } = fakeAgent();
    const { result: hook } = renderHook(() => useChatMessageIdentity(agent));

    expect(hook.current.index.resolvePersisted(STREAM_ID), "映射到达前不猜").toBeNull();
    act(() => {
      emit({
        event: {
          name: AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
          value: { streamingMessageId: STREAM_ID, chatMessageId: PERSISTED_ID },
        },
        messages: [],
      });
    });
    expect(hook.current.index.resolvePersisted(STREAM_ID)).toBe(PERSISTED_ID);
    expect(hook.current.index.resolve(STREAM_ID)).toBe(PERSISTED_ID);
  });

  it("#3397 多气泡映射让整组参与权威恢复，但只在主气泡显示操作入口", () => {
    const { agent, emit } = fakeAgent();
    const { result: hook } = renderHook(() => useChatMessageIdentity(agent));
    const observed: { mutation?: { messages?: Message[] } } = {};
    act(() => {
      observed.mutation = emit({
        event: {
          name: AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
          value: {
            streamingMessageId: "stream-1",
            streamingMessageIds: ["stream-1", "stream-2"],
            chatMessageId: PERSISTED_ID,
          },
        },
        messages: [
          { id: "user", role: "user", content: "问题" },
          { id: "stream-1", role: "assistant", content: "第一段" },
          { id: "stream-2", role: "assistant", content: "第二段" },
        ],
      }) as { messages?: Message[] } | undefined;
    });
    expect(observed.mutation?.messages).toEqual([
      { id: "user", role: "user", content: "问题" },
      { id: "stream-1", role: "assistant", content: "第一段\n\n第二段" },
    ]);
    expect(hook.current.index.resolvePersisted("stream-1")).toBe(PERSISTED_ID);
    expect(hook.current.index.resolvePersisted("stream-2")).toBe(PERSISTED_ID);
    expect(hook.current.index.resolve("stream-1")).toBe(PERSISTED_ID);
    expect(hook.current.index.resolve("stream-2"), "别名气泡不重复显示评分/落地入口").toBeNull();
    expect(hook.current.index.resolve(PERSISTED_ID)).toBe(PERSISTED_ID);
  });

  it("#3397 RUN_FINISHED 不能在持久化正文接管前投影一帧空消息", () => {
    const { agent, emit, finish, endText } = fakeAgent();
    renderHook(() => useChatMessageIdentity(agent));
    act(() => {
      endText(STREAM_ID, "完整流式正文");
      emit({
        event: {
          name: AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
          value: { streamingMessageId: STREAM_ID, chatMessageId: PERSISTED_ID },
        },
        // Real @ag-ui/client clears this snapshot before CUSTOM is observed.
        messages: [],
      });
    });

    expect(finish([])?.messages).toEqual([
      { id: STREAM_ID, role: "assistant", content: "完整流式正文" },
    ]);
  });
});
