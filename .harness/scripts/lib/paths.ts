import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readdirSync, existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url)); // .harness/scripts/lib
export const REPO_ROOT = resolve(here, "..", "..", "..");

export const HARNESS_DIR = join(REPO_ROOT, ".harness");
export const PHASES_DIR = join(REPO_ROOT, "phases");
export const TEMPLATES_DIR = join(HARNESS_DIR, "templates");
export const STATE_DIR = join(HARNESS_DIR, "state");
export const ROADMAP_PATH = join(STATE_DIR, "roadmap.yaml");
export const PROGRESS_PATH = join(STATE_DIR, "PROGRESS.md");
export const COORDINATOR_LOCK_PATH = join(STATE_DIR, "coordinator-lock.json");
export const DEP_GRAPH_PATH = join(STATE_DIR, "dep-graph.md");
export const WORKTREES_DIR = join(REPO_ROOT, ".claude", "worktrees");

export function phaseDirName(id: string, slug: string): string {
  return `phase-${id}-${slug}`;
}

export function findPhaseDir(id: string): string {
  if (!existsSync(PHASES_DIR)) throw new Error(`找不到 phases 目录: ${PHASES_DIR}`);
  const match = readdirSync(PHASES_DIR).find((d) => d.startsWith(`phase-${id}-`));
  if (!match) throw new Error(`找不到 Phase ${id} 的目录(phases/phase-${id}-*)`);
  return join(PHASES_DIR, match);
}

/** 列出全部 phase 目录(绝对路径,按目录名排序,结果稳定)。
 *  #401:开工发现要遍历「有 feature_list 的阶段目录」而不是「阶段 id」——
 *  phases/ 下允许出现 id 相同的两个目录(今天的 phase-16-*),findPhaseDir(id)
 *  只会返回其中一个,按 id 遍历会让另一个阶段的 in_progress 永远发现不了。 */
export function listPhaseDirs(): string[] {
  if (!existsSync(PHASES_DIR)) throw new Error(`找不到 phases 目录: ${PHASES_DIR}`);
  return readdirSync(PHASES_DIR)
    .filter((d) => /^phase-\d+-/.test(d))
    .sort()
    .map((d) => join(PHASES_DIR, d));
}

/** 阶段目录名 → 阶段 id（`phase-11-research-insight-backend` → `11`）。 */
export function phaseIdFromDir(phaseDir: string): string {
  const name = phaseDir.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const m = /^phase-(\d+)-/.exec(name);
  if (!m) throw new Error(`不是合法的 phase 目录名: ${phaseDir}`);
  return m[1]!;
}

/** 阶段目录 → 权威清单路径。id 版与目录版共用这一处文件名约定,不要再写第二处字面量。 */
export function featureListPathIn(phaseDir: string): string {
  return join(phaseDir, "feature_list.json");
}

export function featureArchivePathIn(phaseDir: string): string {
  return join(phaseDir, "feature_list.archive.json");
}

export function sprintDirIn(phaseDir: string, sprintId: string): string {
  return join(phaseDir, "sprints", `sprint-${sprintId}`);
}

export function phaseFeatureListPath(id: string): string {
  return featureListPathIn(findPhaseDir(id));
}

/** 已 passing 且被归档的 feature 存这里；只读合并进 loadFeatureList，永不由常规写路径回写。
 *  见 .harness/instructions/core-loop-readiness-standard.md 附近关于 feature_list 体量的讨论
 *  ——passing 不可逆，归档只是搬家，不是复制第二份事实来源。 */
export function phaseFeatureArchivePath(id: string): string {
  return featureArchivePathIn(findPhaseDir(id));
}

export function sprintDir(phaseId: string, sprintId: string): string {
  return sprintDirIn(findPhaseDir(phaseId), sprintId);
}
