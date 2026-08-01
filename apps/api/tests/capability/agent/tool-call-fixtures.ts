/**
 * Shared fixture for the F60 tool-call audit tests. Deliberately a full, valid record --
 * individual tests override only the field(s) under test so the surrounding four elements
 * (and the O-22⑤/I-48 provenance fields) never accidentally cause an unrelated failure.
 */
import type { RecordToolCallInput } from "../../../src/domain/agent/tool-call-audit";

export function toolCallInput(over: Partial<RecordToolCallInput> = {}): RecordToolCallInput {
  return {
    callId: "call-1",
    signature: "graph.search",
    params: '{"project":"远洋","type":["假设","证据"]}',
    hitCount: 64,
    runState: "成功",
    durationMs: 1200,
    tokens: 400,
    callerAgentId: "agt-ava",
    agentVersion: "v3",
    skillVersion: "v1",
    modelId: "mdl-local-1",
    permissionSnapshot: "snap-1",
    grantingLayer: "mcp-scope",
    messageId: "msg-1",
    threadId: "thr-1",
    projectId: "proj-1",
    ...over,
  };
}
