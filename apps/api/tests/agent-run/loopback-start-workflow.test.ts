/**
 * AG05 —— loopback deep-agent 替身的 `start_workflow` 剧本：标记 `[start_workflow:<id>]`
 * ⇒ 未配对的 `start_workflow` 工具调用 + interrupted；网关以 edit resume 交回 `outcome`
 * 后，终稿正文就是 `outcome.message`（放行 / `workflow_not_allowed` 两条路径）。
 */
import { describe, expect, it } from "vitest";
import { fixture } from "./loopback-deep-agent-fixture";
import { refusedOutcome, startedOutcome } from "../../src/application/agent/request-agent-workflow-start";

const WF = "W029";

async function startTurn(request: ReturnType<typeof fixture>, thread: string, text: string) {
  await request("POST", "/threads", { thread_id: thread });
  await request("POST", `/threads/${thread}/runs`, { input: { messages: [{ role: "user", content: text }] } });
  let status: any;
  for (let i = 0; i < 5; i += 1) status = await request("GET", `/threads/${thread}/runs/${thread}`);
  return status;
}

describe("loopback deep-agent 替身 · start_workflow 剧本（AG05）", () => {
  it("标记命中：停在 interrupted，state 里有未配对的 start_workflow 调用", async () => {
    const request = fixture();
    const status = await startTurn(request, "t1", `请帮我发起流程 [start_workflow:${WF}]`);
    expect(status.status).toBe("interrupted");
    const state = await request("GET", "/threads/t1/state");
    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []);
    expect(calls).toEqual([{ id: "start-workflow-t1", name: "start_workflow", args: { workflowId: WF, input: {} } }]);
    expect(state.values.messages.some((m: any) => m.type === "tool")).toBe(false);
  });

  it.each([
    ["放行（实例已创建）", startedOutcome(WF, { instanceId: "inst-1", status: "running", definitionVersion: 1 } as never)],
    ["拒绝（workflow_not_allowed）", refusedOutcome("workflow_not_allowed", WF)],
  ])("%s：edit resume 交回 outcome ⇒ 终稿 = outcome.message", async (_label, outcome) => {
    const request = fixture();
    await startTurn(request, "t2", `[start_workflow:${WF}]`);
    await request("POST", "/threads/t2/runs", {
      command: { resume: { decisions: [{ type: "edit", edited_action: { name: "start_workflow", args: { workflowId: WF, input: {}, outcome } } }] } },
    });
    const status = await request("GET", "/threads/t2/runs/t2");
    expect(status.status).toBe("success");
    const state = await request("GET", "/threads/t2/state");
    const msgs = state.values.messages;
    expect(msgs.find((m: any) => m.type === "tool" && m.tool_call_id === "start-workflow-t2")?.content).toBe(outcome.message);
    expect(msgs.at(-1)).toMatchObject({ type: "ai", content: outcome.message });
  });

  it("无标记的普通消息不触发该剧本", async () => {
    const request = fixture();
    const status = await startTurn(request, "t3", "你好");
    expect(status.status).toBe("success");
    const state = await request("GET", "/threads/t3/state");
    const calls = state.values.messages.flatMap((m: any) => m.tool_calls ?? []);
    expect(calls.some((c: any) => c.name === "start_workflow")).toBe(false);
  });
});
