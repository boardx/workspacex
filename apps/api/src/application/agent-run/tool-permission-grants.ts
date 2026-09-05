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

/**
 * issue #2774 —— 这个端口此前只在测试里手工 `new`（见 `permission-grant-scopes.test.ts`
 * 直接 `import` 应用层函数），DI 容器里从未有对应 token/provider：`agent-run.controller.ts`
 * 也从未挂过 `decideToolPermission` 的 HTTP 路由，`ToolPermissionCard`（F08）从未接过真实
 * 数据。三处凑在一起才是「四选一裁决弹层」真正可用的完整链路——本 token 是补上 DI 绑定
 * 那一环（见 `kernel.module.ts` 的 provider 注册 + `agent-run.controller.ts` 的新路由）。
 */
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
}

/**
 * 纯内存参考实现——测试用，也可作为无 DB 部署（如 loopback e2e 替身）的降级实现。
 * 进程重启即丢失，"以后都允许"因此不是真正跨进程持久化的；生产环境必须换成
 * `PgToolPermissionGrantRepository`。
 */
export function createInMemoryToolPermissionGrantStore(): ToolPermissionGrantStore {
  const standing = new Set<string>(); // key: `${orgId}:${toolName}`
  const perRun = new Set<string>(); // key: `${orgId}:${runId}:${toolName}`

  return {
    async hasGrant(orgId, runId, toolName) {
      return standing.has(`${orgId}:${toolName}`) || perRun.has(`${orgId}:${runId}:${toolName}`);
    },
    async grantForRun(orgId, runId, toolName) {
      perRun.add(`${orgId}:${runId}:${toolName}`);
    },
    async grantStanding(orgId, toolName) {
      standing.add(`${orgId}:${toolName}`);
    },
    async revokeAllForRun(orgId, runId) {
      const prefix = `${orgId}:${runId}:`;
      for (const key of perRun) {
        if (key.startsWith(prefix)) perRun.delete(key);
      }
    },
  };
}
