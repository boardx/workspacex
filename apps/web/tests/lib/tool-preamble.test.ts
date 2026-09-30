/** UIUX r4：实时流里的工具前导语判据（ag07 与 dh-ui-gaps 两条分支逐字相同）。 */
import { describe, expect, it } from "vitest";
import { hasToolResult, toolPreambleCall, type PreambleMessage } from "@/lib/chat-workbench/tool-preamble";

const isTarget = (name: string) => name === "target_tool";
const user: PreambleMessage = { id: "u", role: "user", content: "q" };
const text: PreambleMessage = { id: "t", role: "assistant", content: "正在提交……" };
const call: PreambleMessage = { id: "c", role: "assistant", content: "", toolCalls: [{ id: "call-1", function: { name: "target_tool" } }] };
const result: PreambleMessage = { id: "r", role: "tool", content: "ok", toolCallId: "call-1" };
const final: PreambleMessage = { id: "f", role: "assistant", content: "后续回答" };

describe("toolPreambleCall", () => {
  it("同条消息带目标调用 ⇒ 命中", () => {
    expect(toolPreambleCall({ ...call, content: "正在提交……" }, [user, call], isTarget)?.id).toBe("call-1");
  });
  it("流式拆条：正文一条、调用气泡紧随其后 ⇒ 命中", () => {
    expect(toolPreambleCall(text, [user, text, call, result, final], isTarget)?.id).toBe("call-1");
  });
  it("调用还没到 ⇒ 不命中；调用之后的回答 ⇒ 不命中", () => {
    expect(toolPreambleCall(text, [user, text], isTarget)).toBeNull();
    expect(toolPreambleCall(final, [user, text, call, result, final], isTarget)).toBeNull();
  });
  it("隔着下一条用户消息或其它工具 ⇒ 不命中", () => {
    expect(toolPreambleCall(text, [user, text, { id: "u2", role: "user", content: "x" }, call], isTarget)).toBeNull();
    const other: PreambleMessage = { ...call, id: "o", toolCalls: [{ id: "x", function: { name: "read_document" } }] };
    expect(toolPreambleCall(text, [user, text, other, call], isTarget)).toBeNull();
  });
  it("hasToolResult 只认对应 id 的 tool 消息", () => {
    expect(hasToolResult([user, text, call], "call-1")).toBe(false);
    expect(hasToolResult([user, text, call, result], "call-1")).toBe(true);
  });
});
