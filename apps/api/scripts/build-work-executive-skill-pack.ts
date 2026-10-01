/**
 * build-work-executive-skill-pack.ts —— 高管线 Work Skill starter-pack 构建。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验（metadata.work、PASS 实体、
 * 覆盖集合、已提交产物 digest）、digest 与落盘全部由共享的 `work-content-pack.ts` 实现。
 *
 * 用法：`npx tsx scripts/build-work-executive-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-executive-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-executive";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-executive/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-executive");

/** 高管线覆盖集合：D001 直调的新作者化 Skill S195–S199（无 Workflow 消费者）+ S013 情景分析（D001 / D017 / D053 直调）。 */
export const EXPECTED_STABLE_IDS: readonly string[] = [
  "S195", "S196", "S197", "S198", "S199", "S013",
];

/** S013 在清单第二阶段标为「✅ 通过」；S195–S199 的 PASS 认定来自第二阶段章节。 */
export const PASS_SECTIONS: readonly string[] = ["## 第一阶段", "## 第二阶段"];

/**
 * S195–S199 已作者化（实体文档 + 本包），但尚无独立评审 PASS（清单仍是 ⬜，评审文件不存在）。
 * 这张豁免会自行失效：清单一旦把其中任一 ID 标为 ✅，构建即报 pending-review-stale，要求把它从这里删掉。
 * 它只让 pack 能被构建与判 G0–G2，**不代表评审通过**；是否放行归人类。
 */
export const PENDING_REVIEW_IDS: readonly string[] = ["S195", "S196", "S197", "S198", "S199"];

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return {
    packId: PACK_ID,
    packVersion: PACK_VERSION,
    root,
    expectedStableIds: EXPECTED_STABLE_IDS,
    passSections: PASS_SECTIONS,
    pendingReviewIds: PENDING_REVIEW_IDS,
  };
}

export function buildWorkExecutivePack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
