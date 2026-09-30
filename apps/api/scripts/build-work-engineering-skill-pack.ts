/**
 * build-work-engineering-skill-pack.ts —— 工程线 Work Skill starter-pack 构建
 * （Work Stack v2 第二阶段 D038 Software Engineer 闭包中的工程类 Skill）。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验、digest 与落盘全部由共享的
 * `work-content-pack.ts` 实现（同 CT01 研究线 / CT07 销售线）。
 *
 * 这 1 个实体（S179 Technical Documentation）已按实体文档作者化，但独立评审（`reviews/<ID>.review.md`）尚未出具、设计签核由人类
 * 随后补齐（2026-09-30 人类授权先实现）——因此它们登记在 `PENDING_REVIEW_IDS`，而不是借道第一阶段
 * PASS 清单。评审 PASS 后把对应 ID 从该常量里删掉即可，构建逻辑不变。
 *
 * 用法：`npx tsx scripts/build-work-engineering-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-engineering-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-engineering";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-engineering/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-engineering");

/** 工程线覆盖集合：1 个 v2 实体（S179）。 */
export const EXPECTED_STABLE_IDS: readonly string[] = ["S179"];

/** 已作者化、待独立评审的实体（评审 PASS 后从此处移除）。 */
export const PENDING_REVIEW_IDS: readonly string[] = EXPECTED_STABLE_IDS;

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return { packId: PACK_ID, packVersion: PACK_VERSION, root, expectedStableIds: EXPECTED_STABLE_IDS, pendingReviewIds: PENDING_REVIEW_IDS };
}

export function buildWorkEngineeringPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
