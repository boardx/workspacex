/**
 * EV04 × WS02 —— 导入时的确定性门判定（`StarterPackGateJudge` 的仓库文件实现）。
 *
 * 不另写任何判定规则：G0–G5 全部走 `judgeWorkStackGates`（门脚本 `lint-work-stack-gates` 的同一纯函数），
 * 身份材料（WORK-STACK-320-LIST.md、实体文档、包间分叉副本）、套件与报告也走门脚本同一个
 * `collectGateSubjects`。唯一替换的是「被测对象」：manifest 取本次导入的 `metadata.work`，
 * 版本 digest 取本次落库版本的 `sha256:<content_digest>`——于是记录与目录里的版本一一对应。
 * 仓库报告是按仓库包 digest 跑的，与落库版本 digest 不同口径，G4/G5 因此如实判 fail（无该版本报告）。
 *
 * 只认仓库里**同一路径**的包（`skills/<packId>/<stableName>/SKILL.md`，内容线 pack 的构建来源）；
 * 运行环境里没有仓库（实体清单缺失）或找不到对应包 ⇒ 不判（返回表里没有该 skill ⇒ 目录「未评测」）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkGateStatus } from "@repo/contracts/work-eval";
import type { StarterPackGateJudge } from "../../application/skill-import/ports";
import { judgeWorkStackGates } from "../../application/work-eval/work-stack-gates";
import { collectGateSubjects } from "./fs-work-stack-gates";

export const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const ENTITY_LIST = "requirements/work-stack-v2/WORK-STACK-320-LIST.md";

export class FsStarterPackGateJudge implements StarterPackGateJudge {
  constructor(private readonly opts: { readonly repoRoot?: string; readonly now?: () => Date } = {}) {}

  judge(input: Parameters<StarterPackGateJudge["judge"]>[0]): ReadonlyMap<string, WorkGateStatus> {
    const out = new Map<string, WorkGateStatus>();
    const repoRoot = this.opts.repoRoot ?? REPO_ROOT;
    if (input.skills.length === 0 || !existsSync(join(repoRoot, ENTITY_LIST))) return out;
    const subjects = collectGateSubjects(repoRoot);
    const now = this.opts.now?.() ?? new Date();
    for (const skill of input.skills) {
      const sourcePath = `skills/${input.packId}/${skill.stableName}/SKILL.md`;
      const subject = subjects.find((s) => s.sourcePath === sourcePath && s.stableId === skill.work.stableId && s.kind === "skill");
      if (!subject) continue;
      const judgement = judgeWorkStackGates(
        { ...subject, manifest: skill.work, manifestError: null, versionDigest: skill.versionDigest },
        now,
      );
      if (judgement.status) out.set(skill.stableName, judgement.status);
    }
    return out;
  }
}
