/**
 * `discoverRemoteMcpTools` -- issue #1852（发现）+ issue #1928（落库）。管理员填一个远程
 * MCP 服务器端点、当场连上去发现真实工具列表，并把这次发现持久化。
 *
 * ## 这条用例做的事，与 `discover-tools.ts` 的关系
 *
 * `discoverMcpTools`（`discover-tools.ts`）已经是抽象在 `McpGateway` 端口之上的用例，
 * 不需要改一行来"换成真实 client"——把真实的 `HttpMcpGateway` 通过 `deps` 传进去即可
 * （见 `infrastructure/mcp/http-mcp-gateway.ts`）。本文件补的是：
 *   ① 管理员授权门（与 `import-skill-from-url.ts` 逐字同一条纪律：**取回之前**先判，
 *      否则非管理员也能让服务端替他发出站请求，成了 SSRF 探测器）；
 *   ② SSRF 字面量校验（`assertMcpEndpointAllowed`）——同样在取回之前；
 *   ③（issue #1928 新增）发现成功后把服务器 + 工具集落库，交给既有的
 *      `initialStatusOnRegister`/`McpReviewStatus`/`McpConnectionStatus` 治理骨架管，
 *      不发明第二套状态。
 *
 * ⚠ 本用例仍然**不**做完整 `registerMcpServer` 该做的事：不判隔离期（F131）、不收集
 *   `isThirdParty`/`involvesCustomerData`——那条契约操作仍未接线（见 `ports.ts` 头注），
 *   本用例落的服务器记录恒为「未开放 / 待安全评审 / 已隔离」的最保守初始状态（首次发现时），
 *   与新工具恒为「未开放」同一立场（I-21：不静默扩大权限）。
 */
import { toOrgId } from "../../domain/org-id";
import { McpEndpointRefusedError, assertMcpEndpointAllowed } from "../../domain/mcp/remote-endpoint-guard";
import { initialStatusOnRegister } from "../../domain/mcp/server-status";
import { sealCredential } from "../../domain/model/credential-vault";
import { discoverMcpTools, type DiscoverMcpToolsResult } from "./discover-tools";
import type { CredentialCipher, McpGateway, McpServerStore, McpToolStore } from "./ports";
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
  readonly servers: McpServerStore;
  /** 只加密，不解密——同 `domain/model/credential-vault.ts` 的纪律。 */
  readonly credentialCipher: CredentialCipher;
  /** 逐请求现传的原始鉴权 token（若有）——只经过 `credentialCipher.encrypt` 一次，
   *  用例函数体内不做第二件事。`null` = 匿名连接，落库时 `sealedCredential` 也是 `null`。 */
  readonly credential: string | null;
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
  (input: {
    readonly orgId: string;
    readonly localOnlyOrg: boolean;
    readonly credential: string | null;
  }): DiscoverRemoteMcpToolsDeps;
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

  // ⚠ 网关调用（真实出站请求）没有被下面的落库步骤包住——落库失败不应让调用方以为
  //   发现本身失败了；发现的结果已经是真的，只是这次没能持久化。落库放在网关调用**之后**，
  //   与 discover-tools.ts 头注「an unreachable server must fail the whole operation」的
  //   顺序一致：先把发现这件事做对，再做"记住它"这件事。
  const result = await discoverMcpTools(
    { gateway: deps.gateway, store: deps.store },
    { serverId: input.serverId, endpoint: input.endpoint },
  );

  // ⚠ 复用 `sealCredential`（domain/model/credential-vault.ts）而不是手搭一个带
  //   `__sealed: true` 品牌字段的对象字面量——那个品牌存在就是为了不让调用方能
  //   "自称已加密"，唯一合法路径是真的调一次这个函数。
  const sealedCredential =
    deps.credential === null ? null : sealCredential(deps.credential, deps.credentialCipher, new Date().toISOString());
  await deps.servers.upsertDiscovered({
    orgId: input.orgId,
    serverId: input.serverId,
    endpoint: input.endpoint,
    registeredByActorId: input.actorId,
    toolCount: result.tools.length,
    discoveredAt: new Date().toISOString(),
    sealedCredential,
    // ⚠ 只在首次插入时生效（见 ports.ts `McpServerStore.upsertDiscovered` 头注）——
    //   `defaultIsolationOn: true` 是本用例唯一支持的姿态：完整的「开关一」尚未接到这条
    //   路径（该开关的 UI 目前只是 `mcp-screen.tsx` 里的本地 state，见该组件头注）。
    initialStatus: initialStatusOnRegister(true),
  });

  return result;
}

export { McpEndpointRefusedError };
