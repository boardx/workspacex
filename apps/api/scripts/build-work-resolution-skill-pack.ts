/**
 * build-work-resolution-skill-pack.ts —— 问题到解决线（W007 Issue-to-Resolution） Work Skill starter-pack 构建。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验（metadata.work、PASS 实体、
 * 覆盖集合、已提交产物 digest）、digest 与落盘全部由共享的 `work-content-pack.ts` 实现。
 *
 * 用法：`npx tsx scripts/build-work-resolution-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-resolution-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-resolution";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-resolution/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-resolution");

/** 问题到解决线覆盖集合：W007 的 S011 根因分析与 S015 回复起草（D006 经 W007 使用；二者在清单第二阶段均为「✅ 通过」）。 */
export const EXPECTED_STABLE_IDS: readonly string[] = ["S011", "S015"];

/** S011、S015 在清单第二阶段标为「✅ 通过」。 */
export const PASS_SECTIONS: readonly string[] = ["## 第一阶段", "## 第二阶段"];

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return {
    packId: PACK_ID,
    packVersion: PACK_VERSION,
    root,
    expectedStableIds: EXPECTED_STABLE_IDS,
    passSections: PASS_SECTIONS,
  };
}

export function buildWorkResolutionPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
