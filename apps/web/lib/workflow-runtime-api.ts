/**
 * WF08 —— Workflow 运行面板 / 审批 UI 的真实 API 薄封装。
 *
 * 范围只是 `@repo/contracts` 的 `workflowRuntime` 束（`packages/contracts/src/workflow-runtime.ts`）：
 * 路径、方法、形状全部取自契约，不在这里另写一份。服务端 projection 是唯一权威——
 * 本文件不合成状态，失败体原样交给调用方按 `WorkflowErrorCode` 渲染。
 */
import { workflowRuntime } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest, apiUrl, getStoredSessionToken } from "./api-client";

const C = workflowRuntime.workflowRuntime;

export type WorkflowInstanceProjection = z.infer<typeof workflowRuntime.WorkflowInstanceProjection>;
export type WorkflowInstanceSummary = z.infer<typeof workflowRuntime.WorkflowInstanceSummary>;
export type WorkflowGateView = z.infer<typeof workflowRuntime.WorkflowGateView>;
export type WorkflowStageView = z.infer<typeof workflowRuntime.WorkflowStageView>;
export type WorkflowSseEnvelope = z.infer<typeof workflowRuntime.WorkflowSseEnvelope>;
export type WorkflowInstanceStatus = z.infer<typeof workflowRuntime.WorkflowInstanceStatus>;
export type WorkflowReasonCode = z.infer<typeof workflowRuntime.WorkflowReasonCode>;
export type WorkflowErrorCode = z.infer<typeof workflowRuntime.WorkflowErrorCode>;
export type WorkflowApprovalItem = z.infer<typeof C.listMyApprovals.out>["items"][number];
export type RunnableWorkflow = z.infer<typeof C.listRunnableWorkflows.out>["items"][number];

function fill(path: string, params: Record<string, string | number>): string {
  return path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(String(params[k] ?? "")));
}

/** 客户端幂等键（契约 `WorkflowRequestId`：8..200 字符）。 */
export function newWorkflowRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `wf-${c.randomUUID()}`;
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 失败体 → 契约错误码；读不到时为 null（界面给通用文案，不编造码）。 */
export function workflowErrorCode(err: unknown): WorkflowErrorCode | null {
  if (!(err instanceof ApiError)) return null;
  const parsed = workflowRuntime.WorkflowErrorBody.safeParse(err.raw);
  return parsed.success ? parsed.data.code : null;
}

export function getWorkflowInstance(instanceId: string): Promise<WorkflowInstanceProjection> {
  return apiRequest(fill(C.getInstance.path, { instanceId }));
}

export function listMyWorkflowInstances(status?: readonly WorkflowInstanceStatus[]): Promise<z.infer<typeof C.listMyInstances.out>> {
  return apiRequest(C.listMyInstances.path, { query: { status: status && status.length > 0 ? status.join(",") : undefined } });
}

export function listMyWorkflowApprovals(includeDecided = false): Promise<z.infer<typeof C.listMyApprovals.out>> {
  return apiRequest(C.listMyApprovals.path, { query: { includeDecided: includeDecided ? "true" : undefined } });
}

export function listRunnableWorkflows(agentId: string): Promise<z.infer<typeof C.listRunnableWorkflows.out>> {
  return apiRequest(fill(C.listRunnableWorkflows.path, { agentId }));
}

type Cmd = { instanceId: string; expectedStateVersion: number };

export function cancelWorkflowInstance(cmd: Cmd): Promise<z.infer<typeof C.cancelInstance.out>> {
  return apiRequest(fill(C.cancelInstance.path, cmd), {
    method: "POST",
    body: { expectedStateVersion: cmd.expectedStateVersion, requestId: newWorkflowRequestId() },
  });
}

export function resumeWorkflowInstance(cmd: Cmd): Promise<z.infer<typeof C.resumeInstance.out>> {
  return apiRequest(fill(C.resumeInstance.path, cmd), {
    method: "POST",
    body: { expectedStateVersion: cmd.expectedStateVersion, requestId: newWorkflowRequestId() },
  });
}

export function retryWorkflowStage(cmd: Cmd & { stageId: string }): Promise<z.infer<typeof C.retryStage.out>> {
  return apiRequest(fill(C.retryStage.path, cmd), {
    method: "POST",
    body: { expectedStateVersion: cmd.expectedStateVersion, requestId: newWorkflowRequestId() },
  });
}

export function approveWorkflowGate(cmd: Cmd & { gateId: string }): Promise<z.infer<typeof C.approveGate.out>> {
  return apiRequest(fill(C.approveGate.path, cmd), {
    method: "POST",
    body: { expectedStateVersion: cmd.expectedStateVersion, requestId: newWorkflowRequestId() },
  });
}

export function denyWorkflowGate(cmd: Cmd & { gateId: string; reason: string }): Promise<z.infer<typeof C.denyGate.out>> {
  return apiRequest(fill(C.denyGate.path, cmd), {
    method: "POST",
    body: { expectedStateVersion: cmd.expectedStateVersion, requestId: newWorkflowRequestId(), reason: cmd.reason },
  });
}

function parseFrame(raw: string): WorkflowSseEnvelope | null {
  const data = raw
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  if (data === "") return null;
  try {
    const parsed = workflowRuntime.WorkflowSseEnvelope.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * 打开实例 SSE（带 Last-Event-ID 续传，E10）。连接正常结束时 resolve；
 * 打不开时 reject——是否降级轮询由调用方决定。
 */
export async function openWorkflowInstanceStream(
  instanceId: string,
  lastEventId: number | null,
  onEnvelope: (env: WorkflowSseEnvelope) => void,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (lastEventId !== null) headers["Last-Event-ID"] = String(lastEventId);
  const response = await fetch(apiUrl(fill(C.streamInstanceEvents.path, { instanceId })), {
    method: "GET",
    headers,
    credentials: "include",
    signal: options.signal,
  });
  if (!response.ok || response.body === null) throw new Error(`workflow stream failed with HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const env = parseFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      if (env) onEnvelope(env);
    }
  }
}
