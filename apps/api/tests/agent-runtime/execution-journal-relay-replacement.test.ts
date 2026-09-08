/**
 * issue #3069 ③ roster-landing —— **回放兜底必须是「替换」，不是「追加」**。
 *
 * ## 基线红的真实形状（e2e run 34198904439 的 trace.zip 里逐字读到的 wire 原文）
 *
 * ```
 * TEXT_MESSAGE_START  <流式 id>            ← 工具跑之前的预告正文
 * TEXT_MESSAGE_END    <流式 id>
 * （tool_start / tool_end，中间没有任何新的 text_delta）
 * TEXT_MESSAGE_START  <落库主键>            ← 整段终稿被当作新气泡重放
 * TEXT_MESSAGE_END    <落库主键>
 * CUSTOM chat_message_id {streamingMessageId: <落库主键>, chatMessageId: <落库主键>}
 * ```
 *
 * 两条后果都是真的产品行为：一轮里两条互相矛盾的 assistant 正文；映射事件退化成
 * 自映射（信息量为零），于是前端身份表永远认不出真实主键，落地按钮挂不上去
 * （`copilotkit-v2-roster-landing.spec.ts` 第 ④ 步测的正是这件事）。
 *
 * 机制在 `execution-journal-relay.ts`：`accept()` 在 `tool_start` 上把 `finalMessageId`
 * 置回 `null`，`finish()` 因此走不到身份路径。
 *
 * ## 本文件钉住的是 coordinator 裁决的 C 方案
 *
 * 撤回已流出的气泡，用**它的 id** 重新呈现落库正文——wire 上只剩一条 assistant 气泡，
 * 且它的 id 就是 `chat_message_id` 映射得起来的那个流式 id（不是自映射）。
 *
 * ⚠ 反证纪律：把 `finish()` 里那段撤回 + carrier 复用删掉、退回「另起一条落库主键气泡」，
 * 下面第一条与第二条 `it` 会当场红在「气泡数应为 1」和「carrier 不应是落库主键」上。
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
  parseAguiAssistantMessageReplacedValue,
} from "@repo/contracts/agui-state-events";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { createExecutionJournalRelay } from "../../src/interface/controllers/execution-journal-relay";

const RUN = "run-3069";
const STREAM_ID = "thread-3069:1:assistant";
const PERSISTED_ID = "chat-message-3069";
const PREVIEW = "已查询当前时间，详情见工具结果。";
const PERSISTED_TEXT = "已查询：当前时间 2026-09-08T06:58:12.321Z。";

type Wire = Record<string, unknown> & { type: EventType };

function drive(): { events: Wire[]; returned: string } {
  const events: Wire[] = [];
  const relay = createExecutionJournalRelay((e) => events.push(e as Wire));
  let seq = 0;
  const emit = (e: Record<string, unknown>) =>
    relay.accept({ ...e, runId: RUN, seq: seq++, emittedAt: new Date(0).toISOString() } as ExecutionEvent);

  // ① 工具之前先流一段预告正文（真实链路里这就是用户先看到的那条气泡）。
  emit({ kind: "text_delta", messageId: STREAM_ID, delta: PREVIEW });
  // ② 工具调用 —— 这一步把 `finalMessageId` 清回 null，账本此后再没有正文。
  emit({ kind: "tool_start", toolCallId: "call-1", toolName: "get_time", args: {} });
  emit({ kind: "tool_end", toolCallId: "call-1", toolName: "get_time", result: "2026-09-08T06:58:12.321Z", ok: true });
  // ③ run 成功，写回拿到落库主键与落库正文（与 ① 的预告**不一致**——#3069 的前提）。
  const returned = relay.finish(PERSISTED_ID, PERSISTED_TEXT);
  return { events, returned };
}

const starts = (events: Wire[]) => events.filter((e) => e.type === EventType.TEXT_MESSAGE_START);

describe("execution journal relay：tool_start 清掉 finalMessageId 且无后续正文时的回放兜底", () => {
  it("wire 上只呈现一条 assistant 气泡，正文是落库正文", () => {
    const { events } = drive();
    const ids = starts(events).map((e) => e.messageId as string);
    expect(new Set(ids).size, `wire 上应只有一条 assistant 气泡，实得 ${JSON.stringify(ids)}`).toBe(1);

    // 该气泡的最终正文 = 落库正文；预告正文在它之前已被显式撤回。
    const replacedIdx = events.findIndex(
      (e) => e.type === EventType.CUSTOM && e.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME,
    );
    expect(replacedIdx, "应发一帧撤回事件").toBeGreaterThanOrEqual(0);
    const replaced = parseAguiAssistantMessageReplacedValue(events[replacedIdx]!.value);
    expect(replaced, "撤回事件必须符合契约 schema").not.toBeNull();
    expect(replaced!.replacedMessageIds).toContain(STREAM_ID);
    expect(replaced!.replacementMessageId).toBe(STREAM_ID);

    const after = events.slice(replacedIdx);
    const contents = after
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta as string);
    expect(contents.join("")).toBe(PERSISTED_TEXT);
    expect(contents.join(""), "撤回之后不应再出现预告正文").not.toContain(PREVIEW);
  });

  it("承载气泡沿用流式 id，映射因此不是自映射", () => {
    const { events, returned } = drive();
    // 控制器拿 `finish()` 的返回值当 `chat_message_id.streamingMessageId`。
    expect(returned).toBe(STREAM_ID);
    expect(returned, "返回落库主键即等于让控制器发自映射（契约禁止）").not.toBe(PERSISTED_ID);
    // 且它就是 wire 上第一个 TEXT_MESSAGE_START 的 id ——
    // `copilotkit-v2-roster-landing.spec.ts` 正是照这条不变量取证的。
    expect(starts(events)[0]!.messageId).toBe(returned);
  });

  it("身份路径成立时一个字都不变：不撤回、不重放", () => {
    const events: Wire[] = [];
    const relay = createExecutionJournalRelay((e) => events.push(e as Wire));
    let seq = 0;
    const emit = (e: Record<string, unknown>) =>
      relay.accept({ ...e, runId: RUN, seq: seq++, emittedAt: new Date(0).toISOString() } as ExecutionEvent);
    emit({ kind: "text_delta", messageId: STREAM_ID, delta: PERSISTED_TEXT });
    emit({ kind: "final_message", messageId: STREAM_ID });
    const returned = relay.finish(PERSISTED_ID, PERSISTED_TEXT);
    expect(returned).toBe(STREAM_ID);
    expect(events.some((e) => e.type === EventType.CUSTOM && e.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME))
      .toBe(false);
    expect(starts(events)).toHaveLength(1);
  });

  it("一条气泡都没流出去时不发撤回帧，气泡 id 即落库主键（此时映射是真话，不是退化）", () => {
    const events: Wire[] = [];
    const relay = createExecutionJournalRelay((e) => events.push(e as Wire));
    relay.accept({
      kind: "tool_start", toolCallId: "call-1", toolName: "get_time", args: {},
      runId: RUN, seq: 0, emittedAt: new Date(0).toISOString(),
    } as ExecutionEvent);
    const returned = relay.finish(PERSISTED_ID, PERSISTED_TEXT);
    expect(returned).toBe(PERSISTED_ID);
    expect(events.some((e) => e.type === EventType.CUSTOM && e.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME))
      .toBe(false);
    expect(starts(events).map((e) => e.messageId)).toEqual([PERSISTED_ID]);
  });

  it("planningNote 气泡**不在**撤回范围内——它是可见的规划步骤，不是回答正文的另一版本", () => {
    const events: Wire[] = [];
    const relay = createExecutionJournalRelay((e) => events.push(e as Wire));
    relay.accept({
      kind: "tool_start", toolCallId: "call-1", toolName: "get_time", args: {},
      planningNote: "我先查一下当前时间。",
      runId: RUN, seq: 0, emittedAt: new Date(0).toISOString(),
    } as ExecutionEvent);
    const returned = relay.finish(PERSISTED_ID, PERSISTED_TEXT);
    // 「规划摘要 + 最终答案」两条气泡是刻意的既有行为（`agui-bridge-tool-call-events.test.ts`
    // 逐条断言它）。#3069 的替换只针对账本正文气泡，不得顺手把它改掉。
    expect(starts(events).map((e) => e.messageId)).toEqual(["call-1:planning", PERSISTED_ID]);
    expect(events.some((e) => e.type === EventType.CUSTOM && e.name === AGUI_ASSISTANT_MESSAGE_REPLACED_EVENT_NAME))
      .toBe(false);
    expect(returned).toBe(PERSISTED_ID);
  });
});
