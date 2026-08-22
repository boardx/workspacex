/**
 * #1705（#728 D-1）—— `setAgentRoleLabel` 的落库：写 `agents.role_label`，并把同一次
 * 变更投影进 `capability_listings.role_label`（若这一行已发布，`id = agentId`）。
 *
 * ## 为什么是独立文件，不是塞进 `pg-create-agent-repository.ts`
 *
 * `lint-permission-paths` 白名单条目按**文件**登记「这个文件只命名哪些租户表」
 * （`create-agent-repo-guard.test.ts` 机械断言 `pg-create-agent-repository.ts` 只命名
 * `agents` 一张表）。本类要写两张表（`agents` + `capability_listings`），塞进那个文件
 * 会让那条断言炸——不是因为写两张表本身有问题（`pg-self-publish-agent-repository.ts`
 * 同样写多张表，走的是它自己的白名单条目），而是「一个文件只讲一件事」这条纪律要求
 * 表面积不同的写路径分文件登记，理由不能含混。
 *
 * ## 为什么两张表在同一个事务里、`capability_listings` 命中 0 行不算失败
 *
 * 授权已在 `set-agent-role-label.ts`（用例层）里作为第一件事完成，本类只负责落库。
 * 一个还没发布的草稿 agent 在 `capability_listings` 里没有对应行——那条 UPDATE
 * 命中 0 行是这类 agent 的正常状态，不是错误；`agents` 那条 UPDATE 才是判断
 * "这个 agent 存在" 的唯一依据（`AGENT_NOT_FOUND` 由它的命中行数决定）。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { SetAgentRoleLabelRepository } from "../../application/agent/set-agent-role-label";

export class PgSetAgentRoleLabelRepository implements SetAgentRoleLabelRepository {
  constructor(private readonly db: DatabasePort) {}

  async setRoleLabel(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly roleLabel: string;
  }): Promise<boolean> {
    return this.db.withTenant(toOrgId(input.orgId), async (session) => {
      const now = new Date().toISOString();
      const updated = await session.query<{ id: string }>(
        `UPDATE agents
            SET role_label = $3, role_label_needs_confirmation = false, updated_at = $4
          WHERE id = $1 AND org_id = $2
      RETURNING id`,
        [input.agentId, input.orgId, input.roleLabel, now],
      );
      if (updated.rows.length !== 1) return false;
      // 投影进面板：命中 0 行是「还没发布」的正常状态，不当错误处理（见文件头注）。
      await session.query(
        `UPDATE capability_listings
            SET role_label = $3, role_label_needs_confirmation = false
          WHERE id = $1 AND org_id = $2 AND kind = 'agent'`,
        [input.agentId, input.orgId, input.roleLabel],
      );
      return true;
    });
  }
}
