/**
 * UC-17.8 B5.2 —— `ModelDesignChatReplier` 与 `parseWriteback` 的正反例。fake port，不打真网络。
 */
import { describe, expect, it, vi } from "vitest";
import { designWorkbench as C } from "@repo/contracts";
import { ModelCallError } from "../../src/application/agent-run/ports";
import {
  DESIGN_CHAT_SYSTEM_PROMPT,
  ModelDesignChatReplier,
  parseWriteback,
  type DesignChatContext,
} from "../../src/application/design-workbench/design-chat-model";

const CTX: DesignChatContext = {
  name: "导出改版",
  template: "wireframe",
  problem: "导出太慢",
  criteria: ["明确问题与目标范围"],
  frames: ["草稿页 1"],
  prototype: [],
  chat: [
    { role: "user", text: "先聊聊", at: "2026-09-05T00:00:00.000Z" },
    { role: "ai", text: "好的", at: "2026-09-05T00:00:01.000Z", source: "model" },
    { role: "user", text: "把成功率写进验收标准", at: "2026-09-05T00:00:02.000Z" },
  ],
};

function replier(complete: (input: { system: string; user: string }) => Promise<{ text: string }>) {
  const log = vi.fn();
  const model = { complete: vi.fn(complete) };
  const r = new ModelDesignChatReplier({ model: model as never, chatModel: { provider: "p", modelId: "m" }, log });
  return { r, model, log };
}

describe("B5.2 ModelDesignChatReplier", () => {
  it("prompt 含项目五个字段与按序历史；JSON 输出 ⇒ reply 文字 + 逐字段解析的 writeback；不传 threadId", async () => {
    const { r, model } = replier(async () =>
      ({ text: '{"reply":"加上了。","writeback":{"criteria":["导出成功率 ≥ 99%"],"frames":[],"name":"改名"}}' }),
    );
    const out = await r.reply(CTX);
    expect(out).toEqual({ text: "加上了。", source: "model", writeback: { criteria: ["导出成功率 ≥ 99%"] } }); // 空数组丢弃；name 不是可写回字段
    const input = model.complete.mock.calls[0]?.[0];
    expect(input).toMatchObject({ modelProvider: "p", modelId: "m", system: DESIGN_CHAT_SYSTEM_PROMPT });
    expect(input).not.toHaveProperty("threadId");
    for (const s of ["导出改版", "wireframe", "导出太慢", "明确问题与目标范围", "草稿页 1", "用户：先聊聊", "助手：好的", "用户：把成功率写进验收标准"]) {
      expect(input?.user).toContain(s);
    }
    expect(input?.user.indexOf("用户：先聊聊")).toBeLessThan(input?.user.indexOf("用户：把成功率") ?? -1);
  });

  it("模型抛错 / 空输出 ⇒ 固定回执 + fallback + 空 writeback，不抛", async () => {
    const failing = replier(async () => { throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "none"); });
    expect(await failing.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {} });
    expect(failing.log).toHaveBeenCalled();
    const empty = replier(async () => ({ text: " " }));
    expect(await empty.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {} });
  });

  it("输出不是 JSON ⇒ 整段当回复（source=model），不写回；JSON 无 reply ⇒ 文字退路但 writeback 仍生效", async () => {
    const plain = replier(async () => ({ text: "我觉得可以先把导出拆成两步。" }));
    expect(await plain.r.reply(CTX)).toEqual({ text: "我觉得可以先把导出拆成两步。", source: "model", writeback: {} });
    const noReply = replier(async () => ({ text: '{"writeback":{"problem":"新背景"}}' }));
    expect(await noReply.r.reply(CTX)).toEqual({ text: C.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: { problem: "新背景" } });
  });

  it("B5.3 prototype 写回：合法整页树保留；一页超限 ⇒ 整个 prototype 字段丢、其余字段照写；prompt 含当前原型与原语说明", async () => {
    const screen = { frame: "聊天", root: { type: "stack", children: [{ type: "text", props: { content: "hi" } }] } };
    const { r, model } = replier(async () => ({ text: JSON.stringify({ reply: "画好了。", writeback: { prototype: [screen] } }) }));
    const out = await r.reply({ ...CTX, prototype: [{ type: "divider" }] });
    expect(out.source).toBe("model");
    expect(out.writeback).toEqual({ prototype: [screen] });
    const input = model.complete.mock.calls[0]?.[0];
    expect(input?.user).toContain('"type":"divider"');
    expect(DESIGN_CHAT_SYSTEM_PROMPT).toContain("navbar");
    const bad = { frame: "x", root: { type: "iframe" } };
    expect(parseWriteback({ criteria: ["a"], prototype: [screen, bad] })).toEqual({ criteria: ["a"] });
  });

  it("B5.3 几千层嵌套的 prototype：不打爆调用栈，只丢 prototype 字段，其余照写", () => {
    let n: unknown = { type: "divider" };
    for (let i = 0; i < 5000; i += 1) n = { type: "stack", children: [n] };
    const log = vi.fn();
    expect(parseWriteback({ criteria: ["a"], prototype: [{ frame: "x", root: n }] }, log)).toEqual({ criteria: ["a"] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("rejected"), expect.objectContaining({ field: "prototype", reason: "depth" }));
  });

  it("parseWriteback：逐字段过契约——非法字段丢、合法保留；非对象 ⇒ {}", () => {
    expect(parseWriteback({ problem: "", criteria: ["a"], frames: "x" })).toEqual({ criteria: ["a"] });
    expect(parseWriteback({ criteria: new Array(21).fill("a") })).toEqual({});
    expect(parseWriteback(null)).toEqual({});
    expect(parseWriteback(["a"])).toEqual({});
  });
});
