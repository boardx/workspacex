/**
 * issue #1852 + issue #1928 —— 装配 `discoverRemoteMcpTools` 的生产依赖。
 *
 * ⚠ `store`（工具集）与 `servers`（服务器记录）都是**逐请求按 `orgId` 现造**的
 *   Postgres 实现（issue #1928 之前 `store` 是进程内存单例，不区分组织——见
 *   `in-memory-mcp-tool-store.ts` 头注；那个实现仍保留，只是不再是这条生产路径用的了）。
 *   `gateway` 同理是**逐请求现造**的（`credential` 与 `localOnlyOrg` 都是请求相关的），
 *   这正是为什么返回的是一个工厂而不是一份固定 deps——与
 *   `import-agent-from-url-composition.ts` 同一条纪律。`credentialCipher` 是唯一真正的
 *   单例：它不持有任何请求状态，与 `AesCredentialCipher`/model pool 复用同一把密钥
 *   （`MODEL_CREDENTIAL_KEY_ENV`）而不是新开一个环境变量——两条凭据保管链走同一套密钥
 *   轮换纪律，比引入第二个必须同步维护的密钥更不容易漂移。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { IdentityRepository } from "../../application/identity/ports";
import type {
  DiscoverRemoteMcpToolsDeps,
  DiscoverRemoteMcpToolsDepsFactory,
} from "../../application/mcp/discover-remote-server";
import type { CredentialCipher } from "../../application/mcp/ports";
import { createHttpMcpGateway } from "./http-mcp-gateway";
import { createPgMcpToolStore } from "./pg-mcp-tool-store";
import { createPgMcpServerStore } from "./pg-mcp-server-store";

export function composeDiscoverRemoteMcpToolsDeps(input: {
  readonly identities: IdentityRepository;
  readonly db: DatabasePort;
  readonly credentialCipher: CredentialCipher;
}): DiscoverRemoteMcpToolsDepsFactory {
  return ({ orgId, localOnlyOrg, credential }): DiscoverRemoteMcpToolsDeps => ({
    identities: input.identities,
    store: createPgMcpToolStore(input.db, orgId),
    servers: createPgMcpServerStore(input.db),
    credentialCipher: input.credentialCipher,
    credential,
    localOnlyOrg,
    gateway: createHttpMcpGateway({ credential, policy: { localOnlyOrg } }),
  });
}
