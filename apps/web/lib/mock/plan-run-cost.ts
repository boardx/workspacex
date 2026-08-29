/**
 * Phase 14 · 需求 1 signoff 原型 mock —— Run 级成本/预算追踪条的各状态样本。
 *
 * ⚠ 纯前端 mock（签核第 ① 件材料），不接后端。这里的金额/占比模拟「读 run 账本」派生结果
 *   （`getPlanLedger` 延伸出的成本字段，需求原文），**不是**前端定价乘法算出来的——真接线时
 *   由服务端提供同一形状，这份 mock 会被替换。
 *
 * 数值力求「像真的」：一次跑了几分钟、调了七八个工具的 Deep Agent run，模型成本落在
 * 几角到几元人民币量级；组织月度预算按一个中小团队几百元量级铺。七态各一屏。
 */
import type { RunCostStatus, RunCostView } from "@/components/plan-control/plan-run-cost-bar";

export const COST_SCENES = [
  "default", "loading", "empty", "invalid", "dep-failed", "denied", "success", "warning", "over",
] as const;
export type CostScene = (typeof COST_SCENES)[number];

export function resolveCostScene(raw?: string): CostScene {
  return (COST_SCENES as readonly string[]).includes(raw ?? "")
    ? (raw as CostScene)
    : "default";
}

export const COST_SCENE_LABEL: Record<CostScene, string> = {
  default: "default 默认（执行中·健康）",
  loading: "loading 加载",
  empty: "empty 空（刚发起）",
  invalid: "invalid 校验失败",
  "dep-failed": "dep-failed 依赖失败（无预算分母）",
  denied: "denied 无权限（看不到组织预算）",
  success: "success 成功（已结算）",
  warning: "warning 偏高（70–90%）",
  over: "over 超支（≥100%）",
};

interface CostSceneData {
  readonly status: RunCostStatus;
  readonly view: RunCostView | null;
  readonly errorMessage?: string;
}

// 一个中小团队的月度模型预算分母（¥），复用组织配额策略量级。
const MONTH_BUDGET = 480.0;
// 本月在本轮之前已经累计的花费（¥）——本轮在此之上继续加。
const MONTH_PRIOR = 214.63;

export function costSceneData(scene: CostScene): CostSceneData {
  switch (scene) {
    case "loading":
      return { status: "loading", view: null };
    case "empty":
      return {
        status: "empty",
        view: { runCostCny: 0, monthUsedCny: MONTH_PRIOR, monthBudgetCny: MONTH_BUDGET, settled: false },
      };
    case "invalid":
      return {
        status: "invalid",
        view: null,
        errorMessage: "成本账本本轮返回了非法金额字段，暂时无法显示花费（已上报）",
      };
    case "dep-failed":
      // 组织从没配过月度预算策略——拿不到分母。本轮 ¥ 照常显示。
      return {
        status: "budget-unavailable",
        view: { runCostCny: 1.87, monthUsedCny: 0, monthBudgetCny: 0, settled: false },
      };
    case "denied":
      // 当前用户无权读组织预算——本轮自己的花费仍可见。
      return {
        status: "denied",
        view: { runCostCny: 1.87, monthUsedCny: 0, monthBudgetCny: 0, settled: false },
      };
    case "success":
      return {
        status: "ready",
        view: {
          runCostCny: 2.47,
          monthUsedCny: MONTH_PRIOR + 2.47,
          monthBudgetCny: MONTH_BUDGET,
          settled: true,
        },
      };
    case "warning":
      // 本月已用逼近 80%——warning 色调 + 进度条转黄。
      return {
        status: "ready",
        view: { runCostCny: 3.12, monthUsedCny: 384.5, monthBudgetCny: MONTH_BUDGET, settled: false },
      };
    case "over":
      // 已超本月预算——destructive 色调 + 超支徽标，但（边界）不做任何自动拦截。
      return {
        status: "ready",
        view: { runCostCny: 4.05, monthUsedCny: 503.9, monthBudgetCny: MONTH_BUDGET, settled: false },
      };
    case "default":
    default:
      // 执行中，健康区间：本轮 ¥1.87，本月累计约 45%。
      return {
        status: "ready",
        view: {
          runCostCny: 1.87,
          monthUsedCny: MONTH_PRIOR + 1.87,
          monthBudgetCny: MONTH_BUDGET,
          settled: false,
        },
      };
  }
}
