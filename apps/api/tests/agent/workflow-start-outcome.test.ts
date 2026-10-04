import { describe, expect, it } from "vitest";
import { startedOutcome, workflowStartEditedArgs, refusedOutcome } from "../../src/application/agent/request-agent-workflow-start";

describe("Workflow start results keep workflow instances distinct from agent runs", () => {
  it("gives the existing instance a read-only detail link without asserting completion", () => {
    const result = startedOutcome("W029", { instanceId: "291002c3-fda5-4f1c-b94e-bedba457116a", status: "running", definitionVersion: 1 });
    expect(result.status).toBe("started");
    expect(result.message).toContain("/workflows/runs/291002c3-fda5-4f1c-b94e-bedba457116a");
    expect(result.message).toContain("不是 Agent runId");
    expect(result.message).toContain("不要把它传给 wx_run_status");
    expect(result.message).toContain("状态查询失败不代表该流程失败");
    expect(result.message).not.toContain("流程已完成");
  });

  it("preserves a blocked or waiting start snapshot rather than claiming background execution", () => {
    for (const status of ["awaiting_gate_decision", "blocked_permission"] as const) {
      const result = startedOutcome("W029", { instanceId: "inst-waiting", status, definitionVersion: 2 });
      expect(result).toMatchObject({ instanceId: "inst-waiting", instanceStatus: status, definitionVersion: 2 });
      expect(result.message).toContain(`发起时返回状态为 ${status}`);
      expect(result.message).not.toContain("流程正在后台运行");
    }
  });

  it("keeps the detail reference on the instance route even when the id has URL separators", () => {
    const result = startedOutcome("W029", { instanceId: "inst/other?org=other#output", status: "running", definitionVersion: 1 });
    expect(result.message).toContain("/workflows/runs/inst%2Fother%3Forg%3Dother%23output");
    expect(result.message).not.toContain("[流程详情](/workflows/runs/inst/other");
  });

  it("only forwards the server-confirmed outcome on resume and leaves refused starts without an instance", () => {
    const result = startedOutcome("W029", { instanceId: "real-instance", status: "running", definitionVersion: 1 });
    const edited = JSON.parse(workflowStartEditedArgs(JSON.stringify({ workflowId: "W029", input: {}, outcome: { instanceId: "forged", status: "succeeded" } }), result));
    expect(edited.outcome).toEqual(result);
    expect(edited.outcome.message).not.toContain("forged");
    const denied = refusedOutcome("workflow_not_allowed", "W029");
    expect(denied.status).toBe("refused");
    expect(denied.message).not.toContain("/workflows/runs/");
  });
});
