/**
 * AG06 —— loopback deep-agent 替身的 `escalate_matter` 剧本：标记 `[escalate:<reason>]`
 * ⇒ 未配对的 `escalate_matter` 工具调用 + interrupted（升级卡片在回环模型上可达）；
 * 目标人裁决（edit resume 带回 decision）后终稿与真实工具体三条回复同构。
 */
import { describe, expect, it } from "vitest";
import { agentRole } from "@repo/contracts";
import { fixture } from "./loopback-deep-agent-fixture";

async function startTurn(request: ReturnType<typeof fixture>, thread: string, text: string) {
  await request("POST", "/threads", { thread_id: thread });
  await request("POST", `/threads/${thread}/runs`, { input: { messages: [{ role: "user", content: text }] } });
  let status: any;
  for (let i = 0; i < 5; i += 1) status = await request("GET", `/threads/${thread}/runs/${thread}`);
  return status;
}

async function resume(request: ReturnType<typeof fixture>, thread: string, decision: unknown) {
  await request("POST", `/threads/${thread}/runs`, { command: { resume: { decisions: [decision] } } });
  const status = await request("GET", `/threads/${thread}/runs/${thread}`);
  const state = await request("GET", `/threads/${thread}/state`);
  return { status, messages: state.values.messages };
}

describe("loopback deep-agent 替身 · escalate_matter 剧本（AG06）", () => {
  it("标记命中：停在 interrupted，state 里有未配对的 escalate_matter 调用，参数符合契约 EscalatePayload", async () => {
    const request = fixture({ LOOPBACK_ESCALATE_MATTER: "预算超限" });
    const status = await startTurn(request, "e1", "这个报价要打 6 折 [escalate:折扣超出我的审批权限]");
    expect(status.status).toBe("interrupted");
    const state = await request("GET", "/threads/e1/state");
    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(agentRole.ESCALATE_TOOL_NAME);
    expect(calls[0].id).toBe("escalate-e1");
    expect(agentRole.EscalatePayload.parse(calls[0].args)).toEqual({
      matter: "预算超限", reason: "折扣超出我的审批权限", target: "requester", contextRefs: [],
    });
    expect(state.values.messages.some((m: any) => m.type === "tool")).toBe(false);
  });

  it("标记只写泛称类别 ⇒ reason 换成具体问句，类别只留在 matter", async () => {
    const request = fixture();
    await startTurn(request, "e1g", "改合同 [escalate:超出职责范围的事项]");
    const state = await request("GET", "/threads/e1g/state");
    const call = state.values.messages.flatMap((m: any) => m.tool_calls ?? [])[0];
    expect(call.args.matter).toBe("超出职责范围的事项");
    expect(call.args.reason).toBe("客户要求在合同里写明 20% 折扣，是否同意？");
  });

  it("目标人同意（edit + decision=resolve）⇒ 终稿带裁决原文", async () => {
    const request = fixture();
    await startTurn(request, "e2", "[escalate:需要法务确认]");
    const { status, messages } = await resume(request, "e2", {
      type: "edit", edited_action: { name: "escalate_matter", args: { matter: "x", reason: "需要法务确认", target: "requester", contextRefs: [], decision: "resolve", decisionText: "可以，按标准合同走" } },
    });
    expect(status.status).toBe("success");
    expect(messages.at(-1)).toMatchObject({ type: "ai", content: "负责人已同意。我会按这个裁决继续。" });
    expect(messages.find((m: any) => m.type === "tool")?.tool_call_id).toBe("escalate-e2");
  });

  it("目标人不同意（edit + decision=reject）⇒ 终稿带理由、不执行", async () => {
    const request = fixture();
    await startTurn(request, "e3", "[escalate:要改价]");
    const { messages } = await resume(request, "e3", {
      type: "edit", edited_action: { name: "escalate_matter", args: { decision: "reject", reason: "本季度不再让利" } },
    });
        expect(messages.at(-1).content).toContain("不会执行");
  });

  it("策略未命中（原样 approve）⇒ 如实说「未升级」，不是「已批准」", async () => {
    const request = fixture();
    await startTurn(request, "e4", "[escalate:随便]");
    const { messages } = await resume(request, "e4", { type: "approve" });
    expect(messages.at(-1).content).toContain("未升级");
  });

  it("无标记的普通消息不触发该剧本", async () => {
    const request = fixture();
    const status = await startTurn(request, "e5", "你好");
    expect(status.status).toBe("success");
    const state = await request("GET", "/threads/e5/state");
    expect(state.values.messages.flatMap((m: any) => m.tool_calls ?? []).some((c: any) => c.name === "escalate_matter")).toBe(false);
  });
});
