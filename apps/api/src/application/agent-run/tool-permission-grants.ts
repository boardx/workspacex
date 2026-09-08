/**
 * Phase 14 F06（`plan-permissions` 契约束 R5，domain.md `StandingToolGrant`）—— 三档
 * 授权粒度的存储端口。授权粒度三档：单次（不持久化，调用方自己不落任何记录）/
 * 本次 run 内（run 生命周期内持久化，run 结束后不再查询）/ 以后都允许（组织级运行时
 * 持久化，无过期，跨 run 生效）。存储在网关侧——内核只需知道调用被批准还是拒绝，
 * 不持有授权状态本身（R5）。
 *
 * 本文件只声明端口与一份纯内存参考实现（测试用；`pg-tool-permission-grant-
 * repository.ts` 是生产落地）。
 */
import type { OrgId } from "../../domain/org-id";

/** DI token -- issue #2767: `decideToolPermission`'s controller wiring (AG-UI resume
 *  path) needs to inject the SAME store `AgentRunExecutor` uses for `hasGrant`, not a
 *  second instance. */
export const TOOL_PERMISSION_GRANT_STORE = Symbol("ToolPermissionGrantStore");

export interface ToolPermissionGrantStore {
  /**
   * 该次 L2 工具调用是否已被授权——命中"以后都允许"（组织级）或"本次 run 内都允许"
   * （run 级）任一档即为已授权。"单次"不经过这里：批准发生的那一刻直接放行，不写
   * 任何记录，因此这里永远看不到"单次"这一档的痕迹（I-4：授权粒度互不越界）。
   */
  hasGrant(orgId: OrgId, runId: string, toolName: string): Promise<boolean>;

  /** "本次 run 内都允许"：只在这个 run 的生命周期内生效，run 结束后不再被查询。 */
  grantForRun(orgId: OrgId, runId: string, toolName: string): Promise<void>;

  /** "以后都允许"：组织级运行时持久化，无过期，跨 run 生效（I-4 验收线索）。 */
  grantStanding(
    orgId: OrgId, toolName: string, grantedByUserId: string,
  ): Promise<void>;

  /**
   * Phase 14 F11（`artifacts-steering` 契约束 R4 E3）—— 插话导致方向性改变时，本 run
   * 内此前"都允许"的授权范围产生歧义，整体撤销（不是逐工具名撤销：任务性质变了，
   * 旧授权是在旧性质下给出的，不应该有任何一个工具名继续沿用）。不影响"以后都允许"
   * （组织级、与本 run 上下文无关，R5）。撤销一个从未被授权过的 run 是无操作，不报错。
   */
  revokeAllForRun(orgId: OrgId, runId: string): Promise<void>;

  /**
   * issue #3068 —— 「以后都允许」的组织级授权清单。撤销的前提是**看得见**：一条看不见
   * 的授权撤不掉，而 F06 当初只做了写入与生效判断（R6 不含管理界面），于是
   * `tool-permission-card.tsx` 那句「可在下次弹出时改选拒绝以撤销」承诺了一个结构上
   * 不可能发生的动作——弹层永远不会再出现。
   *
   * 只列 `forever` 一档：`run` 档随 run 结束自然失效，没有"看不见又收不回"的问题。
   */
  listStanding(orgId: OrgId): Promise<readonly StandingGrantRow[]>;

  /**
   * issue #3068 —— 按 `grantId` 撤销一条组织级授权。撤销后同组织的下一次同类调用重新
   * 走审批（`hasGrant` 不再命中）。撤一条不存在/已被别人撤掉的授权返回 `false`，不报错
   * ——并发下两个管理员点同一行是常态，不是异常。
   */
  revokeStanding(
    orgId: OrgId, grantId: string, revokedByUserId: string,
  ): Promise<boolean>;
}

/** issue #3068 —— 组织级授权清单的一行。`grantId` 是撤销的寻址方式：按 `toolName`
 *  撤销在并发下会撤掉"另一次批准写下的同名那条"，按行 id 撤销不会。 */
export interface StandingGrantRow {
  readonly grantId: string;
  readonly toolName: string;
  /** 谁批的。历史行可能为空（F06 的 `run` 档不记批准人，`forever` 档一直记）。 */
  readonly grantedByUserId: string | null;
  readonly grantedAt: string;
}

/**
 * 纯内存参考实现——测试用，也可作为无 DB 部署（如 loopback e2e 替身）的降级实现。
 * 进程重启即丢失，"以后都允许"因此不是真正跨进程持久化的；生产环境必须换成
 * `PgToolPermissionGrantRepository`。
 */
export function createInMemoryToolPermissionGrantStore(): ToolPermissionGrantStore {
  // issue #3068 —— 从 `Set<string>` 改成按行存：撤销要按 `grantId` 寻址，
  // 一个 `${orgId}:${toolName}` 字符串没有行身份可撤。
  const standing = new Map<string, { orgId: string; row: StandingGrantRow }>();
  const perRun = new Set<string>(); // key: `${orgId}:${runId}:${toolName}`

  return {
    async hasGrant(orgId, runId, toolName) {
      const matched = [...standing.values()]
        .some((e) => e.orgId === orgId && e.row.toolName === toolName);
      return matched || perRun.has(`${orgId}:${runId}:${toolName}`);
    },
    async grantForRun(orgId, runId, toolName) {
      perRun.add(`${orgId}:${runId}:${toolName}`);
    },
    async grantStanding(orgId, toolName, grantedByUserId) {
      const existing = [...standing.values()]
        .find((e) => e.orgId === orgId && e.row.toolName === toolName);
      if (existing) return; // 与生产实现的 ON CONFLICT DO NOTHING 同一语义。
      const grantId = `mem-grant-${standing.size + 1}`;
      standing.set(grantId, {
        orgId,
        row: { grantId, toolName, grantedByUserId, grantedAt: new Date().toISOString() },
      });
    },
    async revokeAllForRun(orgId, runId) {
      const prefix = `${orgId}:${runId}:`;
      for (const key of perRun) {
        if (key.startsWith(prefix)) perRun.delete(key);
      }
    },
    async listStanding(orgId) {
      return [...standing.values()].filter((e) => e.orgId === orgId).map((e) => e.row);
    },
    async revokeStanding(orgId, grantId) {
      const entry = standing.get(grantId);
      if (!entry || entry.orgId !== orgId) return false;
      standing.delete(grantId);
      return true;
    },
  };
}
