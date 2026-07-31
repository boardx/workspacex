/**
 * F122 —— `listProjects` 里「只读原因」的唯一判据。
 *
 * 契约 `ProjectListItem.readOnlyReason` 是 `"archived" | "org-disabled" | null`，
 * 两种只读**必须可分辨**（Q-5 B ↔ Q-7③ 耦合，usecases.md UC-P2「归档项目」/「停用组织下的项目」）。
 * 这个函数是两处呈现共用的**唯一**判据——不许在 controller 或 SQL 里各自判一遍，
 * 那样两处措辞迟早会漂移（本仓已因「同一事实两处声明」出过五次事故，AGENTS.md 逐字）。
 *
 * ## 一个项目同时满足两个条件时,选哪个
 *
 * `archived` 优先：它是容器自己的状态，比组织层的停用更贴近这个项目的因果——
 * 「这个项目被谁归档」总是可回答，而「组织停用」的原因往往在项目视角之外。
 * 两者都不消失,都显示且标注只读(Q-5 B + Q-7③ 逐字「同一种只读呈现」),只是
 * 徽标只能挑一个词,这里挑因果更近的那个。⚠ 这是本 feature 做的判断,契约与
 * usecases.md 都没有回答「两者都成立时选哪个」,已在 issue #103 里报给签核人。
 */
export interface ReadOnlyReasonInput {
  readonly projectStatus: "active" | "archived";
  readonly orgStatus: "active" | "disabled";
}

export type ReadOnlyReason = "archived" | "org-disabled" | null;

export function deriveReadOnlyReason(input: ReadOnlyReasonInput): ReadOnlyReason {
  if (input.projectStatus === "archived") return "archived";
  if (input.orgStatus === "disabled") return "org-disabled";
  return null;
}
