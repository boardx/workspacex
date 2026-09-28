/**
 * Phase 20 WS04 —— Work Skill 依赖就绪性纯函数（契约束 `work-skill-meta` UC-6 / I-11；R3.8，A4/E5/E6）。
 *
 * 输入：manifest 的 required/optional 能力分类 + 本组织工具授权快照（或"查询失败"）+ 分类登记判据。
 * 逐项判定（顺序即优先级，契约 UC-6）：
 *   分类未登记 → missing/CATEGORY_UNREGISTERED；有已授权且启用的工具 → satisfied；
 *   有工具但授权被拒 → denied/GRANT_DENIED；否则 → missing/NO_ENABLED_TOOL。
 * 授权查询失败 → 已登记分类逐项 unknown/GRANT_LOOKUP_FAILED，整体 unknown（未知 ≠ 就绪，E5）。
 * 全部 required satisfied → ready；optional 不影响整体（A4）。不缓存，按请求计算（R7）。
 */
export type ToolGrantState = "granted" | "denied";

export interface OrgToolCapabilityGrant {
  readonly category: string;
  readonly toolRef: string;
  readonly enabled: boolean;
  readonly grant: ToolGrantState;
}

export type ToolGrantSnapshot =
  | { readonly ok: true; readonly grants: readonly OrgToolCapabilityGrant[] }
  | { readonly ok: false };

export type ReadinessReason = "OK" | "CATEGORY_UNREGISTERED" | "NO_ENABLED_TOOL" | "GRANT_DENIED" | "GRANT_LOOKUP_FAILED";

export interface ReadinessItem {
  readonly category: string;
  readonly kind: "required" | "optional";
  readonly state: "satisfied" | "missing" | "denied" | "unknown";
  readonly reasonCode: ReadinessReason;
}

export interface ReadinessResult {
  readonly overall: "ready" | "not_ready" | "unknown";
  readonly missingRequired: number | null;
  readonly items: readonly ReadinessItem[];
}

function judge(category: string, snapshot: ToolGrantSnapshot, isRegistered: (c: string) => boolean): Omit<ReadinessItem, "kind"> {
  if (!isRegistered(category)) return { category, state: "missing", reasonCode: "CATEGORY_UNREGISTERED" };
  if (!snapshot.ok) return { category, state: "unknown", reasonCode: "GRANT_LOOKUP_FAILED" };
  const tools = snapshot.grants.filter((g) => g.category === category && g.enabled);
  if (tools.some((g) => g.grant === "granted")) return { category, state: "satisfied", reasonCode: "OK" };
  if (tools.some((g) => g.grant === "denied")) return { category, state: "denied", reasonCode: "GRANT_DENIED" };
  return { category, state: "missing", reasonCode: "NO_ENABLED_TOOL" };
}

export function computeSkillReadiness(
  dependencies: { readonly required: readonly string[]; readonly optional: readonly string[] },
  snapshot: ToolGrantSnapshot,
  isRegistered: (category: string) => boolean,
): ReadinessResult {
  const items: ReadinessItem[] = [
    ...[...new Set(dependencies.required)].map((c) => ({ ...judge(c, snapshot, isRegistered), kind: "required" as const })),
    ...[...new Set(dependencies.optional)]
      .filter((c) => !dependencies.required.includes(c))
      .map((c) => ({ ...judge(c, snapshot, isRegistered), kind: "optional" as const })),
  ];
  if (!snapshot.ok) return { overall: "unknown", missingRequired: null, items };
  const missingRequired = items.filter((i) => i.kind === "required" && i.state !== "satisfied").length;
  return { overall: missingRequired === 0 ? "ready" : "not_ready", missingRequired, items };
}
