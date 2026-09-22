import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  phaseFeatureListPath,
  phaseFeatureArchivePath,
  featureListPathIn,
  featureArchivePathIn,
  sprintDirIn,
  findPhaseDir,
  phaseIdFromDir,
} from "./paths";
import { buildActiveFeaturesView, renderActiveFeaturesView, ACTIVE_FEATURES_BASENAME } from "./startup-discovery";
import type { Feature, FeatureList, FeatureStatus } from "./types";
import { featurePriority } from "./feature-schema";

/** 读归档文件的 id 集合（不存在则返回空集）。saveFeatureList 用它过滤，防止归档记录被写回 live 文件。 */
function loadArchivedIds(phaseId: string): Set<string> {
  const p = phaseFeatureArchivePath(phaseId);
  if (!existsSync(p)) return new Set();
  const archive = JSON.parse(readFileSync(p, "utf8")) as FeatureList;
  if (!Array.isArray(archive.features)) throw new Error(`feature_list 归档结构非法: ${p}`);
  return new Set(archive.features.map((f) => f.id));
}

/** 合并 live + archive 两个文件的只读视图。archive 只在这里被读入内存，
 *  永不通过 saveFeatureList 写回——它是已冻结（passing）记录的搬家结果，不是第二份可变事实源。 */
function loadFeatureListFromPaths(livePath: string, archivePath: string): FeatureList {
  const fl = JSON.parse(readFileSync(livePath, "utf8")) as FeatureList;
  if (!Array.isArray(fl.features)) throw new Error(`feature_list 结构非法: ${livePath}`);
  if (!existsSync(archivePath)) return fl;
  const archive = JSON.parse(readFileSync(archivePath, "utf8")) as FeatureList;
  if (!Array.isArray(archive.features)) throw new Error(`feature_list 归档结构非法: ${archivePath}`);
  return { ...fl, features: [...archive.features, ...fl.features] };
}

export function loadFeatureList(phaseId: string): FeatureList {
  return loadFeatureListFromPaths(phaseFeatureListPath(phaseId), phaseFeatureArchivePath(phaseId));
}

/** 目录版：按**阶段目录**读权威清单，同一份实现（#401）。
 *  开工发现要遍历目录而不是 id——phases/ 下可以有两个 id 相同的目录，
 *  按 id 走会漏掉其中一个阶段的 in_progress。 */
export function loadFeatureListIn(phaseDir: string): FeatureList {
  return loadFeatureListFromPaths(featureListPathIn(phaseDir), featureArchivePathIn(phaseDir));
}

/** 只写 live 文件。任何 id 已在归档里的 feature 会被剔除，不回写进 live——
 *  归档记录只能由专门的归档脚本搬动，常规调用方（claim/verify/sweep-unblock…）不需要、
 *  也不应该关心这个过滤;它们照常 load → 改字段 → save 即可。 */
export function saveFeatureList(phaseId: string, fl: FeatureList): void {
  const archived = loadArchivedIds(phaseId);
  const live = archived.size === 0 ? fl.features : fl.features.filter((f) => !archived.has(f.id));
  writeFileSync(phaseFeatureListPath(phaseId), JSON.stringify({ ...fl, features: live }, null, 2) + "\n", "utf8");
}

export function featuresForSprint(fl: FeatureList, sprintId: string): Feature[] {
  return fl.features
    .filter((f) => f.sprint === sprintId)
    .sort((a, b) => featurePriority(a) - featurePriority(b));
}

/** 单一来源原则：同一 owner 同时最多一个 in_progress
 *  - 无 owner（null）：全局只能有一个 in_progress（单 agent 模式，兼容旧行为）
 *  - 有 owner：每个 owner 各自最多一个 in_progress（多 agent 并行模式）
 */
export function assertSingleInProgress(fl: FeatureList): void {
  const active = fl.features.filter((f) => f.status === "in_progress");
  // 分两类：有 owner 的（多 agent 模式）和无 owner 的（单 agent 模式）
  const unowned = active.filter((f) => !f.owner);
  const owned = active.filter((f) => !!f.owner);

  // 无 owner 的最多只能有 1 个（兼容单 agent 旧行为）
  if (unowned.length > 1) {
    throw new Error(
      `违反单一 in_progress 不变量，当前有 ${unowned.length} 个无 owner 的 in_progress：` +
        unowned.map((f) => f.id).join(", ")
    );
  }

  // 有 owner 的：按 owner 分组，每组最多 1 个
  const byOwner = new Map<string, string[]>();
  for (const f of owned) {
    const list = byOwner.get(f.owner!) ?? [];
    list.push(f.id);
    byOwner.set(f.owner!, list);
  }
  for (const [owner, ids] of byOwner) {
    if (ids.length > 1) {
      throw new Error(
        `违反单一 in_progress 不变量：owner "${owner}" 有 ${ids.length} 个 in_progress：${ids.join(", ")}`
      );
    }
  }
}

/** 把 sprint 的工作集派生成只读视图(绝不手改)。
 *  视图内容由 lib/startup-discovery.ts 的纯函数构造——**确定性**：同一份权威清单
 *  ⇒ 同样的字节（#401 验收第二条）。这里只负责落盘。 */
export function writeActiveFeaturesIn(phaseDir: string, sprintId: string, fl: FeatureList): string {
  const view = buildActiveFeaturesView(phaseIdFromDir(phaseDir), sprintId, featuresForSprint(fl, sprintId));
  const out = join(sprintDirIn(phaseDir, sprintId), ACTIVE_FEATURES_BASENAME);
  writeFileSync(out, renderActiveFeaturesView(view), "utf8");
  return out;
}

export function writeActiveFeatures(phaseId: string, sprintId: string, fl: FeatureList): string {
  return writeActiveFeaturesIn(findPhaseDir(phaseId), sprintId, fl);
}

export type Counts = Record<FeatureStatus, number>;

export function countByStatus(features: Feature[]): Counts {
  const c: Counts = { not_started: 0, in_progress: 0, blocked: 0, passing: 0 };
  for (const f of features) c[f.status]++;
  return c;
}

/** 是否所有引用的 feature 都已 passing */
export function allPassing(features: Feature[]): boolean {
  return features.length > 0 && features.every((f) => f.status === "passing");
}

export function findFeature(fl: FeatureList, id: string): Feature {
  const f = fl.features.find((x) => x.id === id);
  if (!f) throw new Error(`找不到 feature ${id}`);
  return f;
}
