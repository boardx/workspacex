/**
 * 把「上会材料审阅」方法论导出成一个标准 Agent Skill 包。
 *
 * ## 为什么是「导出」而不是「又写一份」
 *
 * 方法论的唯一事实源是 `apps/web/lib/ic-review/review-prompt.ts`
 * （`apps/api/scripts/ic-review-skill-content.ts` 给它套上 frontmatter，
 * `ensure-platform-skill-catalog.ts` 把它铸成平台内置 skill 落库）。本脚本把
 * **同一份字节**写成 `ic-review/SKILL.md`，因此导出的就是线上真正在跑的那一份，
 * 不是"照着写的一版"。本仓已五次因「同一事实声明在两处」漂移，这里不再开第六次。
 *
 * 漂移由 `apps/api/tests/skill/ic-review-skill-version-bump.test.ts` 机械盯住：
 * committed SKILL.md 与 `IC_REVIEW_SKILL_MD` 不逐字节相等就红。
 *
 * ## ⚠ 本包刻意不注册进 `STANDARD_PLATFORM_PACKS`
 *
 * 平台侧这个 skill 已由 `ensure-platform-skill-catalog.ts` 自愈种子落库
 * （skillId `skill-team1-ic-review-standard`）。再把同一份内容经 starter-pack
 * 导一次，会在目录里出现两个同名 skill、两条版本线——用户看到两个「上会审阅」，
 * 不知道挂哪个。本包的用途是**导出到别的系统**（Claude Code / claude.ai /
 * Agent SDK / 任何吃 Agent Skills 格式的运行时），以及将来真要走 starter-pack
 * 治理时的现成物料。要启用时，先把平台侧那条种子摘掉，不要两条并存。
 *
 * 用法：node --import tsx skills/standard-finance/scripts/build.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256, verifySkillStarterPack } from "../../../apps/api/src/domain/skill/starter-pack";
import { IC_REVIEW_SKILL_MD } from "../../../apps/api/scripts/ic-review-skill-content";

const root = resolve(import.meta.dirname, "..");
const PACK_ID = "standard-finance";
const PACK_VERSION = "1.0.0";

// ① 导出正文：与落库的字节完全一致，不做任何改写/重排。
writeFileSync(resolve(root, "ic-review/SKILL.md"), IC_REVIEW_SKILL_MD);

// ② 打包成 starter-pack 清单（与其余各包同一形状）。
const collect = (directory: string, paths: string[]) =>
  paths.map((path) => {
    const bytes = readFileSync(resolve(root, directory, path));
    return {
      path,
      mediaType: path === "LICENSE" ? "text/plain" : "text/markdown",
      digest: sha256(bytes),
      contentBase64: bytes.toString("base64"),
    };
  });

const skills = [{
  stableName: "ic-review-standard",
  name: "上会审阅",
  semanticVersion: "1.0.0",
  manifest: { capabilityId: "WX-S101" },
  files: collect("ic-review", ["SKILL.md", "references/how-to-import.md", "LICENSE"]),
}];

const unsigned = { schemaVersion: 1, packId: PACK_ID, packVersion: PACK_VERSION, skills };
const pack = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
verifySkillStarterPack(pack, { packId: PACK_ID, packVersion: PACK_VERSION });

mkdirSync(resolve(root, `../starter-packs/${PACK_ID}`), { recursive: true });
writeFileSync(resolve(root, `../starter-packs/${PACK_ID}/${PACK_VERSION}.json`), `${JSON.stringify(pack, null, 2)}\n`);
process.stdout.write(`已导出 ${PACK_ID}/${PACK_VERSION}：SKILL.md ${IC_REVIEW_SKILL_MD.length} 字节\n`);
