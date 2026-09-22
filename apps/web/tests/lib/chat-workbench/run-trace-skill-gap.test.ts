/**
 * 2026-09-22 —— 溯源缺页标记（`skill_activity_gap`）在轨迹里是自己一行，不是一次失败的工具调用。
 *
 * ⚠ 反证的形状与 #3322 完全相同：`traceEntries` 的循环末尾那个分支是写给 `tool_end` 的、
 * 读 `event.ok`。新事件种类只要没被显式认掉，就会掉进那里、被读成 `ok: undefined`，
 * 于是界面上出现一条红的「失败的工具调用」——而缺页既不是工具调用，也不是失败。
 */
import { expect, it } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { SKILL_ACTIVITY_GAP_NOTE } from "@repo/contracts/deployment";
import { traceEntries } from "@/lib/chat-workbench/run-trace";

const base = { runId: "run-1", emittedAt: "2026-09-22T00:00:00Z" };
const gap: ExecutionEvent = { ...base, seq: 3, kind: "skill_activity_gap", note: SKILL_ACTIVITY_GAP_NOTE, attemptId: "attempt-1" };

it("renders the provenance gap as its own observed entry", () => {
  const [entry, ...rest] = traceEntries([gap]);
  expect(rest).toEqual([]);
  expect(entry?.kind).toBe("skill-gap");
  expect(entry?.status).toBe("observed");
  expect(entry?.status).not.toBe("failed");
  expect(entry?.text).toBe(SKILL_ACTIVITY_GAP_NOTE);
  expect(entry?.attemptIds).toEqual(["attempt-1"]);
});

it("does not disturb the tool rows around it", () => {
  const start: ExecutionEvent = { ...base, seq: 1, kind: "tool_start", toolCallId: "call-1", toolName: "call_skill", args: {} };
  const end: ExecutionEvent = { ...base, seq: 2, kind: "tool_end", toolCallId: "call-1", toolName: "call_skill", result: "ok", ok: true };
  const entries = traceEntries([start, end, gap]);
  expect(entries.map((e) => e.kind)).toEqual(["skill", "skill-gap"]);
  expect(entries[0]?.status).toBe("succeeded");
});
