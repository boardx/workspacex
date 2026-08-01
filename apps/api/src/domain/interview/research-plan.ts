/**
 * 研究计划参数面板 —— 纯函数（F85，uc-6-2 R3 步骤7，AC4）。
 *
 * ## 面板四行，每行的事实来源必须能指出来
 *
 * - **建议场次**：由对象名单派生（`suggestedSessionCount` / `multiPersonSessionCount`
 *   由调用方从访谈对象花名册算出、传进来），本文件不重算、不查库。
 * - **每场人数**：`1–3 人` 是 uc-6-2 R7 逐字的业务规则（不随项目变化，因此不是参数）；
 *   `同组织不超过 N 人` 来自契约 `ResearchPlanParams.sameOrgLimit`——**可配置的那一半**。
 * - **时长**：常规时长 = 契约 `ResearchPlanParams.plannedMinutes`；多人场时长按固定倍率
 *   （1.5×，对齐原型 `60 → 90`）从它派生，**不是第二个独立写死的分钟数**。
 * - **数据保留**：`retentionDays` 是 `domain/recording/retention.ts` 的
 *   `resolveMaterialRetention` 解析结果——本文件**不重新解析、不内置默认值 180**。
 *   这正是 AC4「数据保留值按项目参数渲染、代码中无写死天数」的落点：本文件从头到尾
 *   没有一个天数字面量参与计算。
 *
 * `trainingProhibited` 在契约里是可读写的 `boolean`（不像 `recording` 束把它焊死成
 * 字面量 `true`——那是材料级的终局状态，这里是研究计划的可配置意图，两者是不同的事实，
 * 见 `domain/recording/retention.ts` I-37 与本文件的分工）。
 */

/** 每场人数区间——[原型] R7 逐字的固定业务规则，不是项目参数（与 `sameOrgLimit` 分属两件事）。 */
export const PER_SESSION_MIN_HEADCOUNT = 1;
export const PER_SESSION_MAX_HEADCOUNT = 3;

/** 多人场时长倍率——对齐原型「60 分 → 多人场 90 分」（1.5×）。倍率固定，分钟数不固定。 */
export const MULTI_PERSON_DURATION_MULTIPLIER = 1.5;

/**
 * 多人场时长 = 常规时长 × 固定倍率，向上取整到分钟。
 *
 * ⚠ 没有绝对分钟数字面量——若把这里写成 `return 90`，任何 `plannedMinutes !== 60`
 *   的取值都会露馅（见测试对多组 `plannedMinutes` 跑同一条断言）。
 */
export function multiPersonMinutes(plannedMinutes: number): number {
  return Math.ceil(plannedMinutes * MULTI_PERSON_DURATION_MULTIPLIER);
}

export interface ResearchPlanParamsInput {
  /** 契约 `ResearchPlanParams.retentionDays`——只读投影，来自项目的材料保留期解析结果。 */
  readonly retentionDays: number;
  /** 契约 `ResearchPlanParams.trainingProhibited`。 */
  readonly trainingProhibited: boolean;
  /** 契约 `ResearchPlanParams.plannedMinutes`。 */
  readonly plannedMinutes: number;
  /** 契约 `ResearchPlanParams.sameOrgLimit`。 */
  readonly sameOrgLimit: number;
  /** 派生值——由对象名单算出，不落在 `ResearchPlanParams` 契约里。 */
  readonly suggestedSessionCount: number;
  /** 派生值——名单中存在上下级/同组织关系需要拆场的场次数。 */
  readonly multiPersonSessionCount: number;
}

export interface ResearchPlanPanelLine {
  readonly label: string;
  readonly value: string;
}

/** 面板四行，顺序与 [原型] 自上而下一致：建议场次 / 每场人数 / 时长 / 数据保留。 */
export interface ResearchPlanPanel {
  readonly suggestedSessions: ResearchPlanPanelLine;
  readonly perSessionHeadcount: ResearchPlanPanelLine;
  readonly duration: ResearchPlanPanelLine;
  readonly dataRetention: ResearchPlanPanelLine;
}

/** [原型] 末行「数据保留 N 天 · 禁止用于训练」是一行两语义，不是两行——这里只生成一个 line。 */
export function renderResearchPlanPanel(input: ResearchPlanParamsInput): ResearchPlanPanel {
  const trainingClause = input.trainingProhibited ? "禁止用于训练" : "训练开关：允许用于训练";
  return {
    suggestedSessions: {
      label: "建议场次",
      value: `${input.suggestedSessionCount} 场（含 ${input.multiPersonSessionCount} 场多人访谈）`,
    },
    perSessionHeadcount: {
      label: "每场人数",
      value: `${PER_SESSION_MIN_HEADCOUNT}–${PER_SESSION_MAX_HEADCOUNT} 人（同组织不超过 ${input.sameOrgLimit} 人）`,
    },
    duration: {
      label: "时长",
      value: `${input.plannedMinutes} 分（多人场 ${multiPersonMinutes(input.plannedMinutes)} 分）`,
    },
    dataRetention: {
      label: "数据保留",
      value: `数据保留 ${input.retentionDays} 天 · ${trainingClause}`,
    },
  };
}

/**
 * E6：合计时长超过研究计划参数（`plannedMinutes`）时的压缩提示。
 *
 * ⚠ 提示文案里的数字**引用入参**，不写死 60——与 uc-6-1「合计时长超 60 分钟时提示压缩」
 *   同源但取的是项目参数，不是字面量（R3 步骤7 / E6 逐字）。
 */
export function compressionHint(totalMinutes: number, plannedMinutes: number): string | null {
  if (totalMinutes <= plannedMinutes) return null;
  return `合计 ${totalMinutes} 分钟已超过本场计划时长 ${plannedMinutes} 分钟，建议压缩`;
}
