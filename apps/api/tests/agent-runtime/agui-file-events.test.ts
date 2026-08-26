/**
 * DA-16 -- `buildFileCreatedEvents` unit coverage. `agui-file-events.ts`'s own header
 * explains WHY this reads `chat_message_attachments` (via `listThreadAttachments`) rather
 * than the deepagents engine's own `values.files` -- this file only proves the pure
 * mapping/filter/validate logic, not the real-DB round trip (that is
 * `agui-bridge-file-events.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { buildFileCreatedEvents } from "../../src/application/agent-run/agui-file-events";
import type { ThreadAttachmentItem } from "../../src/application/chat/list-thread-attachments";

function item(overrides: Partial<ThreadAttachmentItem> = {}): ThreadAttachmentItem {
  return {
    id: "att-1", filename: "quarterly.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: 20480, createdAt: "2026-08-26T00:00:00.000Z", messageId: "msg-result-1",
    ...overrides,
  };
}

describe("buildFileCreatedEvents", () => {
  it("匹配 resultMessageId 的附件 → 有效 AguiFileCreatedValue，uri 是真实 vfs://attachment/<id>", () => {
    const events = buildFileCreatedEvents([item()], "msg-result-1");
    expect(events).toEqual([{
      uri: "vfs://attachment/att-1",
      domain: "attachment",
      name: "quarterly.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: 20480,
      source: "agent_run_output",
    }]);
  });

  it("messageId 不匹配的附件（这个线程里别的历史消息的材料）被排除——不是这次 run 产出的", () => {
    const events = buildFileCreatedEvents([item({ id: "att-old", messageId: "msg-some-other-turn" })], "msg-result-1");
    expect(events).toEqual([]);
  });

  it("没有任何匹配的附件 → 空数组，不是零值事件", () => {
    expect(buildFileCreatedEvents([], "msg-result-1")).toEqual([]);
  });

  it("多个匹配的附件全部各自产一个事件，顺序与输入一致", () => {
    const events = buildFileCreatedEvents(
      [item({ id: "att-1", filename: "a.pptx" }), item({ id: "att-2", filename: "b.csv", mime: "text/csv" })],
      "msg-result-1",
    );
    expect(events.map((e) => e.uri)).toEqual(["vfs://attachment/att-1", "vfs://attachment/att-2"]);
  });

  it("filename 空白 → AguiFileCreatedValue 校验失败，丢弃该事件，不发编造值（同 chat_message_id 的先例）", () => {
    const events = buildFileCreatedEvents([item({ filename: "   " })], "msg-result-1");
    expect(events).toEqual([]);
  });

  it("id 不是 URI-safe 字符（buildVfsUri 会抛）→ 丢弃该事件，不是让整个调用崩溃", () => {
    const events = buildFileCreatedEvents([item({ id: "att/with/slash" })], "msg-result-1");
    expect(events).toEqual([]);
  });
});
