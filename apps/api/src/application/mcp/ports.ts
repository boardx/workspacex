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
