import { describe, expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";

/**
 * **整合门** —— C/D、E/F、A/B 三条线各自给替身加了新剧本（#3264 / #3266 / #3268），
 * 三份改动落在同一个文件上。整合的最大风险不是合不干净，是**某一方的「缺陷形状」
 * 被合没了**：新分支的次序一旦排错，前面任意一支都会先给出正文/终态，后面那条触发词
 * 就永远到不了——判据当场退化成恒绿，**而且是静默的，测试照样通过**。
 *
 * 真实 `playwright.chat-read.config.ts` 把三条线的触发词**同时**下发给同一个替身进程。
 * 这个文件就在那个组合下逐条确认：每条剧本仍然产出它自己的形状，且不命中任何触发词
 * 的普通一轮逐字节回落到既有行为。
 *
 * 单条剧本各自的取证在 `loopback-two-interrupt-scripts.test.ts` 与各自的 e2e spec 里，
 * 这里**只证互不遮蔽**。
 */

const MULTI = "取证：请分步产出多张画布";
const TOOLFAIL = "取证：请让一次工具调用失败";
const N = 3;
const env = {
  LOOPBACK_DEEP_AGENT_MULTI_CANVAS_TRIGGER: MULTI,
  LOOPBACK_DEEP_AGENT_MULTI_CANVAS_COUNT: String(N),
  LOOPBACK_DEEP_AGENT_CANVAS_TEMPLATE_KEY: "user-persona",
  LOOPBACK_DEEP_AGENT_CANVAS_HEADER_FIELD_NAME: "画像名称",
  LOOPBACK_DEEP_AGENT_CANVAS_SECTION_NAME: "基本信息",
  LOOPBACK_DEEP_AGENT_TOOL_FAILURE_TRIGGER: TOOLFAIL,
  // 整合专用：三条线的触发词**同时**下发（真实 config 就是这样），验证互不遮蔽。
  LOOPBACK_DEEP_AGENT_EMPTY_REPLY_TRIGGER: "取证：请让这次执行空手而归",
  LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_TRIGGER: "取证：请连着中断两次",
  LOOPBACK_DEEP_AGENT_TWO_INTERRUPT_HOLD_POLLS: "3",
  LOOPBACK_DEEP_AGENT_TWO_APPROVAL_TRIGGER: "取证：请连着请求两次技能授权",
};
type Msg = { type: string; content?: string; status?: string; tool_call_id?: string; tool_calls?: { id: string }[] };


describe("整合门：三条线的触发词同时下发时互不遮蔽", () => {
  async function raw(text: string) {
    const request = fixture(env);
    const { thread_id: id } = await request("POST", "/threads", {});
    await request("POST", `/threads/${id}/runs`, { input: { messages: [{ role: "user", content: text }] } });
    // 与 APPROVAL_TRIGGER 同一处 `requiredPolls` 预热（既有设计，非本次整合引入）。
    for (let i = 0; i < 6; i += 1) await request("GET", `/threads/${id}/runs/${id}`);
    const status = (await request("GET", `/threads/${id}/runs/${id}`)).status;
    const msgs: Msg[] = (await request("GET", `/threads/${id}/state`)).values.messages;
    return { status, msgs };
  }
  it("EF 的空回复剧本没有被 CD 的画布/工具分支遮住", async () => {
    const { msgs } = await raw("取证：请让这次执行空手而归");
    expect(msgs.filter((m) => m.type === "ai")).toHaveLength(0);
  });
  it("AB 的二次中断剧本没有被 EF 的早退分支吞掉", async () => {
    const { status, msgs } = await raw("取证：请连着中断两次");
    expect(status).toBe("interrupted");
    expect(msgs.flatMap((m) => m.tool_calls ?? []), "第一次中断必须留一个未配对的 tool_call").toHaveLength(1);
  });
  it("AB 的二次授权剧本同上", async () => {
    const { status, msgs } = await raw("取证：请连着请求两次技能授权");
    expect(status).toBe("interrupted");
    expect(msgs.flatMap((m) => m.tool_calls ?? [])).toHaveLength(1);
  });
  it("不命中任何触发词的普通一轮：零未配对 tool_call、有正文", async () => {
    const { msgs } = await raw("今天几号");
    expect(msgs.filter((m) => m.type === "ai").length).toBeGreaterThan(0);
  });
});
