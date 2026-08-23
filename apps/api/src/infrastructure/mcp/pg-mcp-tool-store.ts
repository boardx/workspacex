/**
 * issue #1928 -- `McpToolStore`（`application/mcp/ports.ts`）的 PostgreSQL 实现,
 * 按组织隔离——取代 `in-memory-mcp-tool-store.ts` 的进程内存单例（那个实现不区分
 * `orgId`，也活不过一次进程重启，仍保留供未接 DB 的组合/测试使用，不删除）。
 *
 * ⚠ **`McpToolStore` 端口的方法签名只有 `serverId`，没有 `orgId`**——与
 * `discover-remote-mcp-tools-composition.ts` 给 `McpGateway` 的处理同一条纪律：
 * `orgId` 是逐请求已知的量，在**构造这个 store 的时候**绑定好，而不是塞进方法签名让
 * 每个调用点各自传一遍（那样多传一次就多一次传错 org 的机会）。
 */
import type { z } from "zod";
import type { McpTool } from "@repo/contracts/agent-runtime";
import type { DatabasePort } from "../../application/ports/database.port";
import type { McpToolStore } from "../../application/mcp/ports";
import { toOrgId } from "../../domain/org-id";

interface ToolRow {
  full_name: string;
  server_id: string;
  signature: string;
  schema_fingerprint: string;
  side_effect: string;
  auth_scope: string;
}

export function createPgMcpToolStore(db: DatabasePort, orgId: string): McpToolStore {
  const org = toOrgId(orgId);
  return {
    async current(serverId) {
      return db.withTenant(org, async (s) => {
        const rows = await s.query<ToolRow>(
          `SELECT full_name, server_id, signature, schema_fingerprint, side_effect, auth_scope
             FROM mcp_tools
            WHERE org_id = $1 AND server_id = $2`,
          [orgId, serverId],
        );
        return rows.rows.map(toContractTool);
      });
    },

    async replace(serverId, tools) {
      await db.withTenant(org, async (s) => {
        // ⚠ 全量覆盖，不是增量 upsert（端口注释「callers pass the full new set, not a
        //   delta」）：先删这台服务器名下的全部旧行，再整批插入新的。
        await s.query(`DELETE FROM mcp_tools WHERE org_id = $1 AND server_id = $2`, [orgId, serverId]);
        for (const tool of tools) {
          await s.query(
            `INSERT INTO mcp_tools
               (org_id, server_id, full_name, signature, schema_fingerprint, side_effect, auth_scope)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orgId, serverId, tool.fullName, tool.signature, tool.schemaFingerprint, tool.sideEffect, tool.authScope],
          );
        }
      });
    },
  };
}

function toContractTool(r: ToolRow): z.infer<typeof McpTool> {
  return {
    fullName: r.full_name,
    serverId: r.server_id,
    signature: r.signature,
    schemaFingerprint: r.schema_fingerprint,
    sideEffect: r.side_effect as z.infer<typeof McpTool>["sideEffect"],
    authScope: r.auth_scope as z.infer<typeof McpTool>["authScope"],
  };
}
