/**
 * plan-control 契约束（TW-P0-3 可编辑计划 + 六态工作流）UI 先行原型 mock 数据。
 * ADR-023 签核第 ① 件材料。纯 mock，不接后端。
 *
 * ⚠ 数据即事实源投影：这里的 phase / gate / progress 全都模拟「读账本」（getPlanLedger, UC-1），
 *   **不是**前端重算（I-7）。前端只渲染 mock 给它的派生值。
 * ⚠ 步骤/约束数量、字段完整度按真实竞品分析任务的量级铺，不是三行假数据。
 *
 * `PlanStepStatus`/`PlanPhase` 直接复用契约的单一事实源
 * `@repo/contracts/plan-control`（签核③），不重新声明这两个封闭枚举（ADR-020）。
 * `PlanStepPreview`/`PlanConstraintPreview` 是**这份预览专属**的形状（`id`/
 * `hostStepId` 等字段名与契约的 `PlanStep`/`PlanConstraint` 不同——契约用
 * `constraintId`/`planStepId`），所以特意不与契约同名，避免「看着像同一份契约、
 * 实际字段对不上」的误导；真正接线时以契约字段名为准，这份 mock 类型会被替换掉。
 */
import type { PlanPhase, PlanStepStatus } from "@repo/contracts/plan-control";

export type { PlanPhase, PlanStepStatus };

export const PLAN_PHASE_LABEL: Record<PlanPhase, string> = {
  preparing: "准备",
  planning: "计划",
  executing: "执行",
  approving: "审批",
  done: "完成",
  failed: "失败",
};

/** 指示线上的五格（failed 不在线上，替换整条 → S6）。domain.md 第一节 5。 */
export const PHASE_LINE: PlanPhase[] = ["preparing", "planning", "executing", "approving", "done"];

export const STEP_STATUS_LABEL: Record<PlanStepStatus, string> = {
  completed: "已完成",
  in_progress: "进行中",
  pending: "待执行",
};

export interface PlanConstraintPreview {
  readonly id: string;
  readonly text: string;
  /** 悬挂的宿主步骤 id；null = 孤儿约束（I-8） */
  readonly hostStepId: string | null;
  /** 孤儿约束记录它原属哪一步（用于「重新挂载」提示） */
  readonly formerHostLabel?: string;
}

export interface PlanStepPreview {
  readonly id: string;
  readonly content: string;
  readonly status: PlanStepStatus;
  readonly constraints: PlanConstraintPreview[];
}

/**
 * 主 mock：一份真实量级的竞品分析计划（5 步，含一条已挂载约束）。
 * 第 3 步 in_progress，前两步 completed，后两步 pending —— 三种步骤状态同屏（G-01）。
 */
export const PLAN_STEPS: PlanStepPreview[] = [
  { id: "s1", content: "澄清目标客群与调研问题", status: "completed", constraints: [] },
  { id: "s2", content: "检索三家主要竞品的公开资料", status: "completed", constraints: [] },
  { id: "s3", content: "逐项对比功能矩阵与定价", status: "in_progress", constraints: [] },
  { id: "s4", content: "提炼差异化机会与风险", status: "pending", constraints: [] },
  {
    id: "s5",
    content: "生成竞品分析报告",
    status: "pending",
    constraints: [
      { id: "c1", text: "只用公开可引用的来源", hostStepId: "s5" },
    ],
  },
];

/** 孤儿约束场景（I-8 / S7）：宿主步骤「生成报告」被删，约束 c1 变孤儿。 */
export const ORPHAN_CONSTRAINT: PlanConstraintPreview = {
  id: "c1",
  text: "只用公开可引用的来源",
  hostStepId: null,
  formerHostLabel: "生成竞品分析报告",
};

/** 确认门（S4 / UC-8）。渲染条件唯一：gate.required === true（前端不自行判断复杂度）。 */
export interface PlanGate {
  readonly required: boolean;
  readonly reason: string;
}

export const GATE_REQUIRED: PlanGate = {
  required: true,
  reason: "这是一个多步、会产出对外报告的任务。执行前请确认计划与约束无误。",
};

export const GATE_NOT_REQUIRED: PlanGate = {
  required: false,
  reason: "简单提问，直接作答，无需确认计划。",
};

/** 执行态进度（S5 / UC-9）。elapsedMs 来自 getPlanLedger.progress，刷新后仍对（非前端计时器）。 */
export interface RunProgress {
  readonly currentStepLabel: string;
  readonly stepIndex: number; // 1-based
  readonly stepTotal: number;
  readonly elapsedMs: number;
}

export const RUN_PROGRESS: RunProgress = {
  currentStepLabel: "逐项对比功能矩阵与定价",
  stepIndex: 3,
  stepTotal: 5,
  elapsedMs: 72_000, // 1 分 12 秒
};

/** 失败态（S6 / UC-10）。两个恢复动作：重试该步 / 修改输入。**不含恢复检查点**（裁决 c）。 */
export interface RunFailure {
  readonly failedStepIndex: number;
  readonly failedStepLabel: string;
  readonly reason: string;
}

export const RUN_FAILURE: RunFailure = {
  failedStepIndex: 5,
  failedStepLabel: "生成竞品分析报告",
  reason: "目标文件无写入权限（project:report/2026Q3.md）",
};

export function formatElapsed(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

/** 预览屏清单（供 preview 路由与截图脚本共用同一事实源）。 */
export const PLAN_CONTROL_SCREENS = [
  { key: "g01", label: "G-01 只读态", uc: "S2 / 判据二" },
  { key: "g02", label: "G-02 编辑态", uc: "S3 / 判据三" },
  { key: "g03", label: "G-03 拖拽中", uc: "S3 调序中间态" },
  { key: "g04", label: "G-04 加约束", uc: "S3 就地输入" },
  { key: "g05", label: "G-05 六态指示器", uc: "S1 / 判据一" },
  { key: "g06", label: "G-06 确认门对照", uc: "S4 / 判据四" },
  { key: "g07", label: "G-07 执行态+告知", uc: "S5 / S8 / I-11" },
  { key: "g08", label: "G-08 失败态", uc: "S6 / 判据六（两动作）" },
] as const;

export type PlanControlScreenKey = (typeof PLAN_CONTROL_SCREENS)[number]["key"];
