/**
 * build-work-research-skill-pack.ts —— 研究线 Work Skill starter-pack 构建
 * （Phase 20 CT01，05-content-lines.md R3）。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验（metadata.work、PASS 实体、
 * 覆盖集合、已提交产物 digest）、digest 与落盘全部由共享的 `work-content-pack.ts` 实现。
 *
 * 用法：`npx tsx scripts/build-work-research-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-research-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-research";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-research/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-research");

/** 研究线覆盖集合（05-content-lines.md R3.1）：18 个 v2 实体。 */
export const EXPECTED_STABLE_IDS: readonly string[] = [
  "S003", "S063", "S171", "S169", "S172", "S170", "S016", "S020", "S168", "S167",
  "S010", "S012", "S017", "S157", "S158", "S160", "S161", "S164",
];

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return { packId: PACK_ID, packVersion: PACK_VERSION, root, expectedStableIds: EXPECTED_STABLE_IDS };
}

export function buildWorkResearchPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
