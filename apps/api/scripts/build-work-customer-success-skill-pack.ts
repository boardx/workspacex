/**
 * build-work-customer-success-skill-pack.ts —— 客户成功线 Work Skill starter-pack 构建
 * （S187–S194，`requirements/work-stack-v2/skills/S187…S194-*.md`；与销售线/研究线/产品线同一构建实现）。
 *
 * 只声明本内容线的 packId / 扫描根 / 覆盖集合；解析、E1 校验（metadata.work、覆盖集合、已提交产物 digest）、
 * digest 与落盘全部由共享的 `work-content-pack.ts` 实现。
 *
 * 与其他内容线的一处差别：这 8 个实体在 WORK-STACK-320-LIST.md 中仍是 ⬜（尚无独立评审 PASS），经人类授权先行实现，
 * 因此用 `pendingReviewIds`（唯一的自失效豁免，见 work-content-pack.ts）放行 PASS 检查。清单改为 ✅ 后构建会报
 * pending-review-stale，届时删掉 `PENDING_REVIEW_IDS`。
 *
 * 用法：`npx tsx scripts/build-work-customer-success-skill-pack.ts`（构建并写出）
 *       `npx tsx scripts/build-work-customer-success-skill-pack.ts --check`（核对已提交产物，不符退出非 0）
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import { buildWorkContentPack, runWorkContentPackCli, type WorkContentPackSpec } from "./work-content-pack";

export { WorkContentPackBuildError, checkCommittedPack } from "./work-content-pack";

export const PACK_ID = "work-customer-success";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-customer-success/`. */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-customer-success");

/** 客户成功线覆盖集合：D006 Skill 列中的 S187–S194（DIGITALHUMAN-COMPOSITION-MATRIX.md 第 12 行）。 */
export const EXPECTED_STABLE_IDS: readonly string[] = ["S187", "S188", "S189", "S190", "S191", "S192", "S193", "S194"];

/** 尚无独立评审 PASS、经人类授权先行实现的实体（见文件头）。 */
export const PENDING_REVIEW_IDS: readonly string[] = EXPECTED_STABLE_IDS;

export function specFor(root: string = DEFAULT_ROOT): WorkContentPackSpec {
  return { packId: PACK_ID, packVersion: PACK_VERSION, root, expectedStableIds: EXPECTED_STABLE_IDS, pendingReviewIds: PENDING_REVIEW_IDS };
}

export function buildWorkCustomerSuccessPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  return buildWorkContentPack(specFor(root));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkContentPackCli(specFor());
}
