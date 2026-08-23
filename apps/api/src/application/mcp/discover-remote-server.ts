/**
 * `discoverRemoteMcpTools` -- issue #1849. 管理员填一个远程 MCP 服务器端点、当场连上去
 * 发现真实工具列表——本轮 MCP 治理骨架第一条说真实协议的路径。
 *
 * ## 这条用例做的事，与 `discover-tools.ts` 的关系
 *
 * `discoverMcpTools`（`discover-tools.ts`）已经是抽象在 `McpGateway` 端口之上的用例，
 * 不需要改一行来"换成真实 client"——把真实的 `HttpMcpGateway` 通过 `deps` 传进去即可
 * （见 `infrastructure/mcp/http-mcp-gateway.ts`）。本文件只补它此前缺的两件事：
 *   ① 管理员授权门（与 `import-skill-from-url.ts` 逐字同一条纪律：**取回之前**先判，
 *      否则非管理员也能让服务端替他发出站请求，成了 SSRF 探测器）；
 *   ② SSRF 字面量校验（`assertMcpEndpointAllowed`）——同样在取回之前。
 *
 * ⚠ 本用例**不**做 `registerMcpServer` 该做的事：不落审计、不判隔离期、不设评审状态——
 *   那条契约操作仍未接线（见 `ports.ts` 头注），本用例只做"发现"，新工具依然落在
 *   `discoverMcpTools` 定的默认值（`未开放`），三层权限求交不受影响。
 */
import { toOrgId } from "../../domain/org-id";
import { McpEndpointRefusedError, assertMcpEndpointAllowed } from "../../domain/mcp/remote-endpoint-guard";
import { discoverMcpTools, type DiscoverMcpToolsResult } from "./discover-tools";
import type { McpGateway, McpToolStore } from "./ports";
import type { IdentityRepository } from "../identity/ports";

export class DiscoverRemoteMcpToolsError extends Error {
  readonly reason = "NOT_ORG_ADMIN" as const;
  constructor(readonly actorId: string) {
    super(`actor "${actorId}" is not an org admin`);
  }
}

export interface DiscoverRemoteMcpToolsDeps {
  readonly identities: IdentityRepository;
  /** 由调用方按端点策略与凭据当场造出的网关——生产绑定是 `createHttpMcpGateway`。 */
  readonly gateway: McpGateway;
  readonly store: McpToolStore;
  readonly localOnlyOrg: boolean;
}

export interface DiscoverRemoteMcpToolsInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly serverId: string;
  readonly endpoint: string;
}

/**
 * DI 边界：controller 拿到的是一个**工厂**，不是装配好的 deps——`gateway` 必须按
 * 逐请求的 `credential` 现造（credential 是请求体的一部分，不是单例能持有的东西），
 * 与 `ImportSkillFromUrlDepsFactory` 同一条纪律（其头注解释了为什么单例在这里是错的）。
 */
export interface DiscoverRemoteMcpToolsDepsFactory {
  (input: { readonly localOnlyOrg: boolean; readonly credential: string | null }): DiscoverRemoteMcpToolsDeps;
}

export const DISCOVER_REMOTE_MCP_TOOLS_DEPS_FACTORY = Symbol("DiscoverRemoteMcpToolsDepsFactory");

export async function discoverRemoteMcpTools(
  deps: DiscoverRemoteMcpToolsDeps,
  input: DiscoverRemoteMcpToolsInput,
): Promise<DiscoverMcpToolsResult> {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new DiscoverRemoteMcpToolsError(input.actorId);
  }

  // ⚠ 字面量 SSRF 门在网关调用之前——网关内部还有第二道（DNS 解析后）门，
  //   两道门缺一都会留下绕过（见 `domain/mcp/remote-endpoint-guard.ts` 头注）。
  assertMcpEndpointAllowed(input.endpoint, { localOnlyOrg: deps.localOnlyOrg });

  return discoverMcpTools(
    { gateway: deps.gateway, store: deps.store },
    { serverId: input.serverId, endpoint: input.endpoint },
  );
}

export { McpEndpointRefusedError };
