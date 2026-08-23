/**
 * `listMcpServers` -- issue #1928. 读回 `discoverRemoteMcpTools` 落库的服务器记录
 * （契约 `agentRuntime.operations.listMcpServers`，`out: z.array(McpServerRow)`）。
 *
 * ⚠ **不返回端点原值、不返回凭据**——`McpServerRow` 本身就没有那两个键
 *   （`credential-endpoint-hidden.test.ts` 机械扫描全部响应 schema 断言这件事），
 *   本用例只是"能力维护者只读服务器名与工具清单，看不到端点与凭据"这句 UI 文案
 *   在后端的落点：`endpointHint` 恒为「外网」——这条发现路径的 SSRF 门
 *   （`assertMcpEndpointAllowed`）本来就只放行公网 `https` 地址，落库的服务器不可能
 *   是「内网」。
 * ⚠ **门禁是 org-admin，与写路径（`discoverRemoteMcpTools`）同一判据**——不是随便一个
 *   组织成员就能读。`lint-permission-paths.mjs` 豁免 `PgMcpServerStore`/`PgMcpToolStore`
 *   的理由逐字是"谁能碰 MCP 服务器记录是 org-admin 问题，裁定挂在这一层"（同
 *   `pg-model-pool-repository.ts` 那条豁免的论证），豁免只在这一层真的判 admin 时成立——
 *   `pg-mcp-server-store-guard.test.ts` 钉住这件事，不是留成一句声明。
 */
import { toOrgId } from "../../domain/org-id";
import type { McpServerStore } from "./ports";
import type { IdentityRepository } from "../identity/ports";

export class ListMcpServersError extends Error {
  readonly reason = "ROLE_INSUFFICIENT" as const;
  constructor(readonly actorId: string) {
    super(`actor "${actorId}" is not an org admin`);
  }
}

export interface ListMcpServersDeps {
  readonly identities: IdentityRepository;
  readonly servers: McpServerStore;
}

export interface ListMcpServersInput {
  readonly orgId: string;
  readonly actorId: string;
}

export interface ListedMcpServer {
  readonly serverId: string;
  readonly name: string;
  readonly description: string;
  readonly endpointHint: "内网" | "外网";
  readonly authScope: string;
  readonly reviewStatus: string;
  readonly connectionStatus: string;
  readonly quarantineUntil: string | null;
  readonly involvesCustomerData: boolean;
  readonly isEgress: boolean;
  readonly toolCount: number;
  readonly lastDiscoveredAt: string | null;
  readonly credentialConfigured: boolean;
}

export async function listMcpServers(
  deps: ListMcpServersDeps,
  input: ListMcpServersInput,
): Promise<readonly ListedMcpServer[]> {
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new ListMcpServersError(input.actorId);
  }

  const rows = await deps.servers.listForOrg(input.orgId);
  // ⚠ 恒为「外网」——不是省事，是这条发现路径本身的 SSRF 门只放行公网地址
  // （`assertMcpEndpointAllowed`），所以落库的服务器不存在「内网」这一分支。
  return rows.map((r) => ({
    serverId: r.serverId,
    name: r.name,
    description: r.description,
    endpointHint: "外网" as const,
    authScope: r.authScope,
    reviewStatus: r.reviewStatus,
    connectionStatus: r.connectionStatus,
    quarantineUntil: r.quarantineUntil,
    involvesCustomerData: r.involvesCustomerData,
    isEgress: r.isEgress,
    toolCount: r.toolCount,
    lastDiscoveredAt: r.lastDiscoveredAt,
    credentialConfigured: r.credentialConfigured,
  }));
}
