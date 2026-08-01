/**
 * 回滚的来源版本约束（F30 / `uc-2-4` R4 A1、R7「回滚」、V7）。
 *
 * ⚠ 这条约束管的是**回滚目标版本**，与新版本号怎么生成无关（那部分见
 *   `blueprint-version.ts` 的 `rollbackToVersion`：回滚恒产生新版本，版本号只增不减）。
 * 原文（Backlog）：「回滚只允许回到未被任何进行中项目使用的版本」——
 * 不满足时必须**列出**「哪些进行中项目正用着该版本」，不是只给一句失败。
 *
 * ⚠ 「进行中项目」在本仓的项目状态里对应 `ProjectStatus.active`
 *   （`packages/contracts/src/project.ts`：`active` / `archived` 二值封闭，
 *   `archived` 项目不算「进行中」）。
 */

import type { ProjectBlueprintSnapshot } from "./snapshot-binding";

/** 项目侧最小切片：够判定「是不是进行中」+ 定位是哪个项目就够了，不需要项目全量形状。 */
export interface ProjectSnapshotUsage extends ProjectBlueprintSnapshot {
  readonly projectStatus: "active" | "archived";
}

export type RollbackTargetVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "ROLLBACK_TARGET_IN_USE";
      /** ⚠ 契约 detail 逐字要求列出正在用它的进行中项目，不是只给一句失败（A1） */
      readonly inUseByProjectIds: readonly string[];
    };

/**
 * 目标版本是否可作为回滚来源。
 *
 * ⚠ 只看 `active` 项目：一个已 `archived` 的项目虽然快照仍指向该版本
 *   （快照不因项目归档而失效），但它不是「进行中」，不阻断回滚。
 */
export function evaluateRollbackTargetGate(
  targetVersionId: string,
  usages: readonly ProjectSnapshotUsage[],
): RollbackTargetVerdict {
  const inUseByProjectIds = usages
    .filter((u) => u.blueprintVersionId === targetVersionId && u.projectStatus === "active")
    .map((u) => u.projectId);
  if (inUseByProjectIds.length > 0) {
    return { allowed: false, reason: "ROLLBACK_TARGET_IN_USE", inUseByProjectIds };
  }
  return { allowed: true };
}
