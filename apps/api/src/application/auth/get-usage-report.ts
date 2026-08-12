/**
 * F161 `getUsageReport` —— 「用量监控」tab 的读用例。
 *
 * 这一层只做两件事：把窗口翻译成一个时间起点，以及把仓储给的原始聚合摆成矩阵。
 * **占比在这里算一次**（不是前端算）——前端各算一遍就会出现两个四舍五入口径，
 * 而它们会同时显示在同一屏上。
 */
import type { OrgId } from "../../domain/org-id";
import type { UsageAggregateRepository, UsageWindowKey } from "./token-quota-ports";

export interface GetUsageReportOutput {
  readonly window: UsageWindowKey;
  readonly totalTokens: number;
  readonly callCount: number;
  readonly failedCallCount: number;
  readonly activeMemberCount: number;
  readonly models: readonly string[];
  readonly rows: readonly {
    readonly userId: string;
    readonly displayName: string;
    readonly perModel: readonly number[];
    readonly total: number;
  }[];
  readonly distribution: readonly {
    readonly modelId: string;
    readonly tokens: number;
    readonly share: number;
  }[];
}

export async function getUsageReport(
  deps: { readonly repo: UsageAggregateRepository },
  input: { readonly orgId: OrgId; readonly window: UsageWindowKey },
): Promise<GetUsageReportOutput> {
  const agg = await deps.repo.readUsage(input.orgId, input.window);

  /*
   * 列的顺序：按该模型在窗口内的总用量降序。
   * ⚠ 不用固定的模型清单（`lib/mock/admin-limits.USAGE_MATRIX_MODELS` 那种写死五列）：
   *   写死的列会在组织换了模型之后继续显示五个空列，而真正在用的那个模型一列都没有。
   *   窗口内没有任何调用时 `models` 是空数组——界面据此渲染空态，不是渲染五个 0。
   */
  const byModel = new Map<string, number>();
  for (const c of agg.cells) byModel.set(c.modelId, (byModel.get(c.modelId) ?? 0) + c.tokens);
  const models = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);

  const byUser = new Map<string, { displayName: string; perModel: number[]; total: number }>();
  for (const c of agg.cells) {
    const row = byUser.get(c.userId)
      ?? { displayName: c.displayName, perModel: models.map(() => 0), total: 0 };
    const idx = models.indexOf(c.modelId);
    if (idx >= 0) row.perModel[idx] = (row.perModel[idx] ?? 0) + c.tokens;
    row.total += c.tokens;
    byUser.set(c.userId, row);
  }

  const rows = [...byUser.entries()]
    .map(([userId, r]) => ({ userId, displayName: r.displayName, perModel: r.perModel, total: r.total }))
    .sort((a, b) => b.total - a.total);

  const totalTokens = agg.totalTokens;
  const distribution = models.map((modelId) => {
    const tokens = byModel.get(modelId) ?? 0;
    // 分母为 0 时 share 记 0 而不是 NaN——NaN 会在界面上渲染成一个空白，
    // 看起来像「这一行没数据」，而其实是「整个窗口没数据」。
    return { modelId, tokens, share: totalTokens === 0 ? 0 : tokens / totalTokens };
  });

  return {
    window: input.window,
    totalTokens,
    callCount: agg.callCount,
    failedCallCount: agg.failedCallCount,
    activeMemberCount: byUser.size,
    models,
    rows,
    distribution,
  };
}
