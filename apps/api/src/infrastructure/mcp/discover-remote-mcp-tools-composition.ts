/**
 * issue #1849 —— 装配 `discoverRemoteMcpTools` 的生产依赖。
 *
 * ⚠ `store` 在这里是**单例**（进程内存，见 `in-memory-mcp-tool-store.ts`）——它必须跨请求
 *   存活，否则"重新发现"的变更集（added/removed/signatureChanged）永远算不出来。
 *   `gateway` 相反，是**逐请求现造**的（`credential` 与 `localOnlyOrg` 都是请求相关的），
 *   这正是为什么返回的是一个工厂而不是一份固定 deps——与
 *   `import-agent-from-url-composition.ts` 同一条纪律。
 */
import type { IdentityRepository } from "../../application/identity/ports";
import type {
  DiscoverRemoteMcpToolsDeps,
  DiscoverRemoteMcpToolsDepsFactory,
} from "../../application/mcp/discover-remote-server";
import type { McpToolStore } from "../../application/mcp/ports";
import { createHttpMcpGateway } from "./http-mcp-gateway";

export function composeDiscoverRemoteMcpToolsDeps(input: {
  readonly identities: IdentityRepository;
  readonly store: McpToolStore;
}): DiscoverRemoteMcpToolsDepsFactory {
  return ({ localOnlyOrg, credential }): DiscoverRemoteMcpToolsDeps => ({
    identities: input.identities,
    store: input.store,
    localOnlyOrg,
    gateway: createHttpMcpGateway({ credential, policy: { localOnlyOrg } }),
  });
}
