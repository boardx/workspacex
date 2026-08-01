/**
 * `authorizeAgentMcpDiscovery` -- F54 (UC-21.2 R3 步骤 9 / R12 V8 / V9): 开关四的运行时
 * 阻断——agent 尝试接入未登记的 MCP 服务器被拒绝并计入越权拦截计数.
 *
 * ⚠ 复用 F53 的 `InterceptCounterPort`（同一份拦截计数，"后台数据总览"不应按开关分裂成
 *   两套计数器）——但 `reason` 需要一个 F53 三码之外的第四种，见 `ports.ts` 里
 *   `InterceptCounterPort.recordDenied` 的 `reason` 联合类型在本文件旁被扩展的位置。
 */
import {
  assertAgentCannotDiscover,
  type AgentDiscoveryAttempt,
} from "../../domain/mcp/agent-discovery-guard";
import type { AgentDiscoveryInterceptPort } from "./ports";

export interface AuthorizeAgentDiscoveryDeps {
  readonly intercepts: AgentDiscoveryInterceptPort;
}

export type AuthorizeAgentDiscoveryResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "AGENT_CANNOT_DISCOVER_MCP"; readonly detail: string };

export async function authorizeAgentMcpDiscovery(
  deps: AuthorizeAgentDiscoveryDeps,
  attempt: AgentDiscoveryAttempt,
): Promise<AuthorizeAgentDiscoveryResult> {
  const check = assertAgentCannotDiscover(attempt);
  if (check.ok) return { allowed: true };

  // 拒绝一律计入越权拦截计数，落在"后台数据总览"（V8）。
  await deps.intercepts.recordDenied({
    requestedServerId: attempt.requestedServerId,
    requestedByAgentId: attempt.requestedByAgentId,
    reason: "AGENT_CANNOT_DISCOVER_MCP",
  });

  return { allowed: false, reason: check.reason, detail: check.detail };
}
