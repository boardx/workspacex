/**
 * Ports MCP tool discovery needs. Defined here, implemented by `infrastructure`
 * (dependency inversion).
 *
 * ⚠ **F52's original claim -- "ships no PostgreSQL implementation" -- is superseded by
 * issue #1928.** The reasoning at the time was sound (persisting servers and tools is a
 * schema decision that belongs with F53/F54's shape); it is no longer speculative now that
 * F53 (`review-mcp-server.ts`) and F54 (`set-security-policy.ts`) exist and already commit to
 * `McpReviewStatus` / `McpConnectionStatus`. `McpServerStore` below reuses that exact
 * vocabulary rather than inventing a second one -- see `PersistedMcpServer`.
 */
import type { z } from "zod";
import type { McpTool, SecurityPolicy, ToolAuthScope, ToolSideEffect } from "@repo/contracts/agent-runtime";
import type { ReviewStatus, ConnectionStatus, AuthScope } from "../../domain/mcp/server-status";
import type { CredentialCipher, SealedCredential } from "../../domain/model/credential-vault";

export type { CredentialCipher, SealedCredential };

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

/** DI token. issue #1852's `createInMemoryMcpToolStore` is the first bound implementation. */
export const MCP_TOOL_STORE = Symbol("McpToolStore");

/**
 * F130 -- the write path `setToolAuthScope` needs, independent of `McpToolStore`'s
 * per-server shape (that port takes a `serverId`; the write path only has a `toolFullName`
 * and must not be made to guess or re-derive which server it belongs to).
 *
 * ⚠ **`updateAuthScope` writes only the `authScope` field.** It is not a general tool
 * upsert -- `sideEffect` / `signature` / `schemaFingerprint` are discovery's to change
 * (`McpToolStore.replace`), not this write path's.
 */
export interface ToolAuthScopeStore {
  /** The tool currently recorded under this full name, or `null` if none is. */
  findByFullName(toolFullName: string): Promise<z.infer<typeof McpTool> | null>;
  /** Persists the new `authScope` for an already-recorded tool. */
  updateAuthScope(
    toolFullName: string,
    authScope: z.infer<typeof ToolAuthScope>,
  ): Promise<void>;
}

/** `setToolAuthScope` rejects a tool full name nothing has ever discovered. */
export class McpToolNotFoundError extends Error {
  readonly reason = "MCP_TOOL_NOT_FOUND" as const;
  constructor(readonly toolFullName: string) {
    super(`MCP tool "${toolFullName}" is not recorded`);
  }
}

/**
 * `TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP` -- I-28′, the contract's code for `checkToolScopeCap`
 * rejecting a write. Carried as a typed error (like `McpServerUnreachableError` above)
 * rather than a bare string, so callers can `instanceof`-check it without parsing messages.
 */
export class ToolScopeExceedsSideEffectCapError extends Error {
  readonly reason = "TOOL_SCOPE_EXCEEDS_SIDE_EFFECT_CAP" as const;
  constructor(
    readonly toolFullName: string,
    readonly maxAllowedRank: number,
    readonly requestedRank: number,
  ) {
    super(
      `MCP tool "${toolFullName}": requested authScope rank ${requestedRank} exceeds the ` +
        `side-effect cap (max allowed rank ${maxAllowedRank})`,
    );
  }
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

/**
 * F54 -- 开关四拒绝事件的计数口。⚠ **独立接口，不是塞进 `InterceptCounterPort`**：
 * 那个接口的 `reason` 是 F53 已经封闭的三码联合类型（`MCP_SERVER_ISOLATED` /
 * `MCP_SERVER_IN_QUARANTINE` / `AUTH_SCOPE_DENIED`），改它的类型形状属于改一个已合入
 * main 的既有契约面，风险与收益不对称；`AGENT_CANNOT_DISCOVER_MCP` 是"这次调用引用的
 * 服务器根本不存在"，与三码回答的"存在但你不能用"是不同的问题。两个接口都写向同一份
 * "后台数据总览"展示，由基础设施层的实现决定落到同一张表还是分表——这是持久化细节，
 * 不是这两个 port 形状该不该合并的理由。
 */
export interface AgentDiscoveryInterceptPort {
  recordDenied(event: {
    readonly requestedServerId: string;
    readonly requestedByAgentId: string;
    readonly reason: "AGENT_CANNOT_DISCOVER_MCP";
  }): Promise<void>;
}

/**
 * F54 -- 四开关的持久化口。⚠ **没有 `delete`**——策略永远存在（默认值 or 已变更的值），
 * "关闭"是把某个布尔字段改成 `false`，不是删掉一整份策略；`set` 覆盖式写入完整对象，
 * 调用方（`setSecurityPolicy` 用例）负责只改动一个开关、其余字段原样带回。
 */
export interface SecurityPolicyStore {
  get(): Promise<z.infer<typeof SecurityPolicy>>;
  set(policy: z.infer<typeof SecurityPolicy>): Promise<void>;
}

/**
 * F54 -- 放行评审记录的持久化口。⚠ **只有 `append`**，没有 `update`/`delete`——
 * "结论与理由不可删除"（R7）在这一层落成"接口里根本没有能删除/修改的方法"，
 * 与 `provenance_events` 的 append-only 同一种表达方式（见 `review-flow.ts` 文件头）。
 */
export interface ReviewRecordStore {
  append(record: {
    readonly reviewId: string;
    readonly serverId: string;
    readonly reviewerId: string;
    readonly at: string;
    readonly verdict: "放行" | "维持隔离" | "有条件放行";
    readonly reason: string;
    readonly grantedToolIds: readonly string[];
    readonly authScopeSet: string | null;
  }): Promise<void>;
  /** 该服务器已有的评审记录，倒序（供审计检索 V16，phase-1 只暴露内存实现） */
  listByServer(serverId: string): Promise<readonly { readonly reviewerId: string }[]>;
}

/**
 * issue #1928 -- 发现结果落库后，能被 `listMcpServers` 读回的一行。
 *
 * ⚠ 有意不带 `credential`/密文 -- 与 `StoredModel`（model pool）同一条纪律
 * （`credentialConfigured` 是一个布尔，不是一个可以还原出密文的字段）。
 */
export interface PersistedMcpServer {
  readonly serverId: string;
  readonly name: string;
  readonly description: string;
  readonly endpoint: string;
  readonly authScope: AuthScope;
  readonly reviewStatus: ReviewStatus;
  readonly connectionStatus: ConnectionStatus;
  readonly quarantineUntil: string | null;
  readonly involvesCustomerData: boolean;
  readonly isEgress: boolean;
  readonly credentialConfigured: boolean;
  readonly toolCount: number;
  readonly lastDiscoveredAt: string;
}

/**
 * issue #1928 -- 把一次成功的发现（`discoverRemoteMcpTools`）落成一条可在
 * `listMcpServers` 读回的服务器记录，交给既有的评审/策略治理骨架管，而不是绕开它另起
 * 一套。
 *
 * ⚠ **`upsertDiscovered` 只在首次插入时写 `initialStatus`。** 重新发现同一台服务器
 * （相同 `orgId` + `serverId`）只刷新 `endpoint`/`toolCount`/`lastDiscoveredAt` 与凭据
 * （若本次提供了新的），**不触碰 `reviewStatus`/`connectionStatus`**——已经过评审的服务器
 * 不该被一次重新发现悄悄打回未评审状态，这与 `discoverMcpTools` 用例头注第 2 条
 * （重新发现不改白名单）是同一条"发现只报告事实，不越权改治理状态"的纪律。
 */
export interface McpServerStore {
  upsertDiscovered(input: {
    readonly orgId: string;
    readonly serverId: string;
    readonly endpoint: string;
    readonly registeredByActorId: string;
    readonly toolCount: number;
    readonly discoveredAt: string;
    readonly sealedCredential: SealedCredential | null;
    /** 仅在首次插入（该 org+server 之前从未落库）时生效。 */
    readonly initialStatus: { readonly reviewStatus: ReviewStatus; readonly connectionStatus: ConnectionStatus };
  }): Promise<void>;

  listForOrg(orgId: string): Promise<readonly PersistedMcpServer[]>;
}

/** DI 令牌。 */
export const MCP_SERVER_STORE = Symbol("McpServerStore");
