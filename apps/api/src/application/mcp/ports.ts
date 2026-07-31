/**
 * Ports MCP tool discovery needs. Defined here, implemented by `infrastructure`
 * (dependency inversion).
 *
 * ⚠ **F52 ships no PostgreSQL implementation.** Persisting servers and tools is a schema
 * decision that belongs with F53/F54 (review records, security switches) -- building the
 * tables now would be guessing at the shape they have to live with. What F52 owns is the
 * SHAPE of the question discovery asks of a gateway, and the invariants over the answer.
 */
import type { z } from "zod";
import type { McpTool, ToolSideEffect } from "@repo/contracts/agent-runtime";

/** `MCP_SERVER_UNREACHABLE` -- the contract's code, carried rather than re-invented at the edge. */
export class McpServerUnreachableError extends Error {
  readonly reason = "MCP_SERVER_UNREACHABLE" as const;
  constructor(readonly serverId: string) {
    super(`MCP server "${serverId}" did not answer`);
  }
}

/** `REQUEST_TIMEOUT` -- UC-21.1 R9: answer within 10s or fail explicitly. Never hang. */
export class McpDiscoveryTimeoutError extends Error {
  readonly reason = "REQUEST_TIMEOUT" as const;
  constructor(readonly serverId: string) {
    super(`MCP tool discovery for "${serverId}" timed out`);
  }
}

/**
 * What a gateway reports for one tool -- **without** a full name and **without** an auth scope.
 *
 * ⚠ The full name is NOT taken from the gateway. `mcp:<server>.<tool>` is OUR namespace; a
 * third-party server reporting `fullName: "graph.search"` would otherwise collide with the
 * reserved namespace inside every agent's tool whitelist. The server names the tool; we name
 * the namespace.
 *
 * ⚠ The auth scope is NOT taken from the gateway either -- a remote server does not get to
 * say how widely its own tools are exposed. New tools land on
 * `NEWLY_DISCOVERED_TOOL_DEFAULT_SCOPE` (I-21).
 */
export interface DiscoveredTool {
  readonly name: string;
  readonly signature: string;
  readonly sideEffect: z.infer<typeof ToolSideEffect>;
}

export interface McpGateway {
  /** Lists the server's tools, or rejects with one of the two errors above. */
  listTools(serverId: string, endpoint: string): Promise<readonly DiscoveredTool[]>;
}

export interface McpToolStore {
  /** Tools currently recorded for this server (empty for a server never discovered). */
  current(serverId: string): Promise<readonly z.infer<typeof McpTool>[]>;
  /** Replaces the recorded set. Callers pass the full new set, not a delta. */
  replace(serverId: string, tools: readonly z.infer<typeof McpTool>[]): Promise<void>;
}

/**
 * F53 -- 越权拦截计数（`user_visible_behavior`：「后台数据总览可见」）.
 *
 * ⚠ **每一次拒绝都记一条**，包括 `MCP_SERVER_ISOLATED` / `MCP_SERVER_IN_QUARANTINE` /
 *   `AUTH_SCOPE_DENIED` 三种理由（contract 行 397 / 404 / 463 附近逐条标了「计入越权拦截计数」）。
 *   本接口只收集事件，**不做聚合**——「后台数据总览」怎么汇总是消费方（数据总览页）的事。
 */
export interface InterceptCounterPort {
  recordDenied(event: {
    readonly serverId: string;
    readonly toolFullName: string | null;
    readonly actorId: string;
    readonly reason: "MCP_SERVER_ISOLATED" | "MCP_SERVER_IN_QUARANTINE" | "AUTH_SCOPE_DENIED";
  }): Promise<void>;
}

/**
 * F53 -- 第③层的申请接口（`requestTaskPermissionGrant`）落库口。
 *
 * ⚠ 权限包的**判定与授予**属 00-core / 11-board（X-1，跨束）。这里只负责把「申请」这件事
 *   持久化成 `pending-human` 状态，交给任务侧的人去按 `[去授权]`——**不判定，不代授权**。
 */
export interface TaskPermissionGrantStore {
  create(request: {
    readonly requestId: string;
    readonly taskId: string;
    readonly toolFullName: string;
    readonly requestedByAgentId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface RequestIdFactory {
  next(): string;
}
