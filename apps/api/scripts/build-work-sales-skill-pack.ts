/**
 * build-work-sales-skill-pack.ts —— 销售线 Work Skill starter-pack 构建
 * （Phase 20 CT07，05-content-lines.md R3）。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验（metadata.work、PASS 实体、
 * 覆盖集合、已提交产物 digest）、digest 与落盘全部由共享的 `work-content-pack.ts` 实现。
 *
 * 用法：`npx tsx scripts/build-work-sales-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-sales-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-sales";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-sales/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-sales");

/** 销售线覆盖集合（05-content-lines.md R3.7）：D005 矩阵行 14 个 Skill + W015/W016/W018 额外依赖 S035/S033/S010/S009。S010 与 CT01 共享，两份副本逐字节相同（同一 stableName@version 只有一份内容）。 */
export const EXPECTED_STABLE_IDS: readonly string[] = [
  "S021", "S022", "S023", "S024", "S025", "S026", "S005", "S028", "S029", "S030", "S031", "S032", "S034", "S036",
  "S035", "S033", "S010", "S009",
];

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return { packId: PACK_ID, packVersion: PACK_VERSION, root, expectedStableIds: EXPECTED_STABLE_IDS };
}

export function buildWorkSalesPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
