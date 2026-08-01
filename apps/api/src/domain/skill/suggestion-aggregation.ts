/**
 * 改进建议聚合 + 归类分流（F68；UC-3.6 R3 阶段二，O-35，`usecases.md` `listSuggestions`/`classifySuggestion`）。
 *
 * ⚠ 聚合键是**结构性判据**，不是相似度打分（O-35 已裁决）：
 *   `(skillId, skillVersionId, agentId, 人工归类的问题标签)` 四者**全相等**才归为一组。
 *   任何一项不同都是不同的建议——不引入「差不多同一类问题」这种不可复现的判断。
 */

export type SuggestionCategory = "contract-solvable" | "implementation-defect" | "model-limited";

export interface StructuralIssueKey {
  readonly skillId: string;
  readonly skillVersionId: string;
  readonly agentId: string;
  /** 人工归类的问题标签（不是 AI 打分出来的相似度桶） */
  readonly issueLabel: string;
}

export function structuralKeyOf(k: StructuralIssueKey): string {
  return `${k.skillId}::${k.skillVersionId}::${k.agentId}::${k.issueLabel}`;
}

/**
 * 一条原始案例。⚠ `isThumbsDown` 区分「真的点了 👎」与「未点 👎 但被判定为同类实例」——
 * 原型 `👎9 / 12 个原始案例` 的口径不等就落在这个字段上，两个数字必须分别标注（R3 步骤 3）。
 */
export interface ThumbsDownCase extends StructuralIssueKey {
  readonly caseId: string;
  readonly raterId: string;
  readonly isThumbsDown: boolean;
}

export interface AggregatedSuggestion {
  readonly key: StructuralIssueKey;
  /** ⚠ 与 `caseCount` 分别标注、不得混用（R3 步骤 3 反证：👎9 但 12 个案例） */
  readonly thumbsDownCount: number;
  readonly caseCount: number;
  readonly caseIds: readonly string[];
  /** `null` ⇒ 尚未归类（人工归类字段，见 R7） */
  readonly category: SuggestionCategory | null;
  /** I-27：聚合与建议文案由 AI 产出，必须标识为机器产出 */
  readonly machineGenerated: true;
}

/**
 * 按结构性判据聚合。`category` 表把已有的人工归类结果并入结果（`suggestionId` 用
 * `structuralKeyOf` 的值充当，因为聚合项本身就是由这四个字段唯一确定的）。
 */
export function aggregateSuggestions(
  cases: readonly ThumbsDownCase[],
  category: Readonly<Record<string, SuggestionCategory>> = {},
): readonly AggregatedSuggestion[] {
  const byKey = new Map<string, { key: StructuralIssueKey; caseIds: string[]; thumbsDown: number }>();

  for (const c of cases) {
    const k = structuralKeyOf(c);
    const bucket = byKey.get(k) ?? { key: c, caseIds: [], thumbsDown: 0 };
    bucket.caseIds.push(c.caseId);
    if (c.isThumbsDown) bucket.thumbsDown += 1;
    byKey.set(k, bucket);
  }

  return [...byKey.entries()].map(([k, bucket]) => ({
    key: bucket.key,
    thumbsDownCount: bucket.thumbsDown,
    caseCount: bucket.caseIds.length,
    caseIds: bucket.caseIds,
    category: category[k] ?? null,
    machineGenerated: true as const,
  }));
}

/**
 * V6/AC4：只有归类为 `contract-solvable` 的条目才出现 `[生成 skill 改进 PR]`。
 * `null`（未归类）与其余两类一律不给这个按钮——避免对着还没定性的问题就生成契约变更提案。
 */
export function canGenerateProposal(category: SuggestionCategory | null): boolean {
  return category === "contract-solvable";
}

export type SuggestionRoute = "skill-improvement" | "software-feedback" | "model-swap" | "unclassified";

/** A1/A2：归类决定分流出口——`implementation-defect` 走软件反馈通道，`model-limited` 走换模型入口。 */
export function routeFor(category: SuggestionCategory | null): SuggestionRoute {
  switch (category) {
    case "contract-solvable":
      return "skill-improvement";
    case "implementation-defect":
      return "software-feedback";
    case "model-limited":
      return "model-swap";
    default:
      return "unclassified";
  }
}
