/**
 * issue #1928 -- `McpServerStore`（`application/mcp/ports.ts`）的 PostgreSQL 实现，
 * 表结构见 migration `20260824090000_i1928_mcp_server_persistence.sql`。
 *
 * ⚠ `listForOrg` 的 SELECT 列表**枚举字段**，且从不选 `mcp_server_secrets.ciphertext`
 * （那张表对 `app_rw` 的列级 GRANT 本来就不含它，`SELECT *` 在数据库层直接
 * `permission denied for column ciphertext` -- 与 `PgModelPoolRepository` 同一条纪律，
 * 见该文件头注的完整论证）。`credentialConfigured` 用 `EXISTS`，不读密文本身。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { McpServerStore, PersistedMcpServer } from "../../application/mcp/ports";
import type { ReviewStatus, ConnectionStatus, AuthScope } from "../../domain/mcp/server-status";
import { toOrgId } from "../../domain/org-id";

interface ServerRow {
  server_id: string;
  name: string;
  description: string;
  endpoint: string;
  auth_scope: string;
  review_status: string;
  connection_status: string;
  quarantine_until: string | null;
  involves_customer_data: boolean;
  is_egress: boolean;
  tool_count: number;
  last_discovered_at: string;
  credential_configured: boolean;
}

export function createPgMcpServerStore(db: DatabasePort): McpServerStore {
  return {
    async upsertDiscovered(input) {
      const orgId = toOrgId(input.orgId);
      await db.withTenant(orgId, async (s) => {
        // ⚠ ON CONFLICT DO UPDATE 有意**不写** review_status/connection_status/
        //   registered_by_actor_id -- 重新发现刷新的是"这次看到了什么"（端点、工具计数、
        //   时间），不刷新"这台服务器目前处在治理流程的哪一步"（见 ports.ts 头注）。
        await s.query(
          `INSERT INTO mcp_servers
             (org_id, server_id, name, description, endpoint, auth_scope,
              review_status, connection_status, quarantine_until,
              involves_customer_data, is_egress, registered_by_actor_id,
              tool_count, first_discovered_at, last_discovered_at)
           VALUES ($1, $2, $3, $4, $5, '未开放', $6, $7, NULL, false, true, $8, $9, $10, $10)
           ON CONFLICT (org_id, server_id) DO UPDATE SET
             endpoint = EXCLUDED.endpoint,
             tool_count = EXCLUDED.tool_count,
             last_discovered_at = EXCLUDED.last_discovered_at`,
          [
            input.orgId,
            input.serverId,
            // 展示名：发现面板不收集独立的名字，`serverId` 兼作 `name`（见迁移头注）。
            input.serverId,
            `远程发现于 ${input.discoveredAt}，共 ${input.toolCount} 个工具`,
            input.endpoint,
            input.initialStatus.reviewStatus,
            input.initialStatus.connectionStatus,
            input.registeredByActorId,
            input.toolCount,
            input.discoveredAt,
          ],
        );

        if (input.sealedCredential !== null) {
          const sealed = input.sealedCredential;
          // ⚠ 有意**不用** `ON CONFLICT ... DO UPDATE`——PostgreSQL 对它的实现要求执行者
          //   对目标表有 SELECT 权限（即便 SET 的右侧全部来自 EXCLUDED、完全不读旧行的
          //   任何列），实测（本文件对应的真实数据库测试）就是在这一步撞上
          //   `permission denied for table mcp_server_secrets`——而这张表的列级 GRANT
          //   刻意不包含 `ciphertext` 的 SELECT（迁移头注的整条纪律）。`model_secrets`
          //   （0019）从来不需要面对这个问题，因为它的写路径从不对同一行重复插入。
          //   DELETE + INSERT 只需要 DELETE 与 INSERT 权限，两者都已整表授予，不涉及
          //   SELECT，因此不撞这堵墙。
          await s.query(`DELETE FROM mcp_server_secrets WHERE org_id = $1 AND server_id = $2`, [
            input.orgId,
            input.serverId,
          ]);
          await s.query(
            `INSERT INTO mcp_server_secrets (org_id, server_id, ciphertext, algorithm, key_id, sealed_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [input.orgId, input.serverId, sealed.ciphertext, sealed.algorithm, sealed.keyId, sealed.sealedAt],
          );
        }
      });
    },

    async listForOrg(orgId) {
      return db.withTenant(toOrgId(orgId), async (s) => {
        const rows = await s.query<ServerRow>(
          `SELECT m.server_id, m.name, m.description, m.endpoint, m.auth_scope,
                  m.review_status, m.connection_status, m.quarantine_until,
                  m.involves_customer_data, m.is_egress, m.tool_count, m.last_discovered_at,
                  EXISTS (
                    SELECT 1 FROM mcp_server_secrets sec
                     WHERE sec.org_id = m.org_id AND sec.server_id = m.server_id
                  ) AS credential_configured
             FROM mcp_servers m
            ORDER BY m.last_discovered_at DESC`,
        );
        return rows.rows.map(toPersisted);
      });
    },
  };
}

function toPersisted(r: ServerRow): PersistedMcpServer {
  return {
    serverId: r.server_id,
    name: r.name,
    description: r.description,
    endpoint: r.endpoint,
    authScope: r.auth_scope as AuthScope,
    reviewStatus: r.review_status as ReviewStatus,
    connectionStatus: r.connection_status as ConnectionStatus,
    // ⚠ `pg` 把 `timestamptz` 解出来的是一个 `Date` 实例，不是字符串——即便声明的行类型
    // 写着 `string`。与 `pg-guided-research-session-repository.ts` 等既有仓库同一条纪律：
    // 显式 `new Date(...).toISOString()`，不依赖调用方隐式 `.toString()` 撞对格式。
    quarantineUntil: r.quarantine_until === null ? null : new Date(r.quarantine_until).toISOString(),
    involvesCustomerData: r.involves_customer_data,
    isEgress: r.is_egress,
    credentialConfigured: r.credential_configured,
    toolCount: r.tool_count,
    lastDiscoveredAt: new Date(r.last_discovered_at).toISOString(),
  };
}
