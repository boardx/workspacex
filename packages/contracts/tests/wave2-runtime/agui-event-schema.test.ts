import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/core";
import { KernelStreamEvent, aguiEventTypeFor } from "../../src/streaming-transport";

type StatusChangeEvent = Extract<KernelStreamEvent, { type: "status_change" }>;
type CheckpointSavedEvent = Extract<KernelStreamEvent, { type: "checkpoint_saved" }>;

/**
 * Phase 14 F03 (`streaming-transport` 契约束, R7) -- "六类事件...直接对齐 CopilotKit
 * AG-UI 协议原生事件类型,不自造平行格式".
 *
 * 这条测试不是业务行为测试(那两条在 apps/api,断言 WS 端点真的按序转发/延迟达标)。
 * 这里只断言一件契约层面的事:六类事件的每一个具体值,`aguiEventTypeFor` 都能映射到
 * `@ag-ui/core`(本仓 apps/web/apps/api 已经在用的同一个包)**真实存在**的 `EventType`
 * 成员上 -- 证明这不是本文件自己发明的一套平行词汇表,而是有真实、可核验的对应关系。
 */

const NOW = "2026-09-05T00:00:00.000Z";

const SIX_SAMPLE_EVENTS: readonly KernelStreamEvent[] = [
  {
    type: "token_delta", runId: "run-1", seq: 0, delta: "hello", emittedAt: NOW,
  },
  {
    type: "tool_call_start", runId: "run-1", seq: 1, toolCallId: "tc-1", toolName: "search",
    args: { query: "weather" }, emittedAt: NOW,
  },
  {
    type: "tool_call_end", runId: "run-1", seq: 2, toolCallId: "tc-1", ok: true,
    result: { hits: 3 }, emittedAt: NOW,
  },
  {
    type: "plan_update", runId: "run-1", seq: 3,
    plan: { todos: [{ content: "step 1", status: "pending" }] }, emittedAt: NOW,
  },
  {
    type: "status_change", runId: "run-1", seq: 4, status: "running", pausedBy: null,
    emittedAt: NOW,
  },
  {
    type: "checkpoint_saved", runId: "run-1", seq: 5, checkpointId: "run-1:2", emittedAt: NOW,
  },
];

describe("aguiEventTypeFor -- alignment with @ag-ui/core native EventType", () => {
  it("maps every one of the six KernelStreamEvent kinds to a REAL @ag-ui/core EventType member", () => {
    const realEventTypeValues = new Set(Object.values(EventType));
    for (const event of SIX_SAMPLE_EVENTS) {
      const mapped = aguiEventTypeFor(event);
      expect(
        realEventTypeValues.has(mapped),
        `${event.type} mapped to "${mapped}", which is not a member of the real @ag-ui/core EventType enum`,
      ).toBe(true);
    }
  });

  it("does not collapse every kind into CUSTOM -- wherever AG-UI already has a native concept, that native type is used", () => {
    const mapping = Object.fromEntries(
      SIX_SAMPLE_EVENTS.map((event) => [event.type, aguiEventTypeFor(event)]),
    );
    expect(mapping.token_delta).toBe(EventType.TEXT_MESSAGE_CONTENT);
    expect(mapping.tool_call_start).toBe(EventType.TOOL_CALL_START);
    expect(mapping.tool_call_end).toBe(EventType.TOOL_CALL_END);
    // `AguiTodosSnapshot` is a full snapshot, not a JSON-patch delta -- STATE_SNAPSHOT is the
    // native fit (and the one `apps/web/lib/agui-plan-todos.ts` already consumes for
    // `write_todos`, see this function's own file-head doc for why).
    expect(mapping.plan_update).toBe(EventType.STATE_SNAPSHOT);
  });

  it("status_change maps terminal outcomes to AG-UI's own RUN_FINISHED/RUN_ERROR, not CUSTOM", () => {
    const succeeded: StatusChangeEvent = {
      type: "status_change", runId: "run-1", seq: 0, status: "succeeded", pausedBy: null, emittedAt: NOW,
    };
    const cancelled: StatusChangeEvent = {
      type: "status_change", runId: "run-1", seq: 0, status: "cancelled", pausedBy: null, emittedAt: NOW,
    };
    const failed: StatusChangeEvent = {
      type: "status_change", runId: "run-1", seq: 0, status: "failed", pausedBy: null, emittedAt: NOW,
    };
    expect(aguiEventTypeFor(succeeded)).toBe(EventType.RUN_FINISHED);
    expect(aguiEventTypeFor(cancelled)).toBe(EventType.RUN_FINISHED);
    expect(aguiEventTypeFor(failed)).toBe(EventType.RUN_ERROR);
  });

  it("status_change falls back to CUSTOM only for the non-terminal states AG-UI has no native slot for", () => {
    const noNativeSlot: readonly StatusChangeEvent["status"][] = [
      "queued", "running", "awaiting_plan_confirmation", "awaiting_tool_permission", "paused",
    ];
    for (const status of noNativeSlot) {
      const event: StatusChangeEvent = {
        type: "status_change", runId: "run-1", seq: 0, status, pausedBy: null, emittedAt: NOW,
      };
      expect(aguiEventTypeFor(event)).toBe(EventType.CUSTOM);
    }
  });

  it("checkpoint_saved -- a concept AG-UI has no native equivalent for -- uses AG-UI's own CUSTOM extension axis", () => {
    const event: CheckpointSavedEvent = {
      type: "checkpoint_saved", runId: "run-1", seq: 0, checkpointId: "cp-1", emittedAt: NOW,
    };
    expect(aguiEventTypeFor(event)).toBe(EventType.CUSTOM);
  });

  it("every KernelStreamEvent variant parses under the strict zod schema (schema itself stays a single source of truth)", () => {
    for (const event of SIX_SAMPLE_EVENTS) {
      expect(() => KernelStreamEvent.parse(event)).not.toThrow();
    }
  });
});
