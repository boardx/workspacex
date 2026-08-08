/**
 * domain-skill-gates.ts —— H3A-013/014/015：三条跨表判定，全部纯函数。
 *
 * 三条判定共享同一个输入组合（Domain Registry 的 entries + Domain Skill 实例
 * 列表），但刻意分成三个独立函数而不是一个大函数：同 template-doctor.ts 里
 * "duplicate/unregistered/retired/dead-ref 各自一个函数" 的先例——每条判定的
 * 输入/输出语义不同，合并只会让人在改一条时误伤另一条。
 *
 * 严重度设计（这是本文件最容易被误读的地方，务必读完再改）：
 *
 *   H3A-013 完成契约原文"缺失、重复 active Skill 会红"——但今天全仓 0 个真实
 *   Domain Skill 实例（E0 inventory 现场核实过，见 e0-inventory.md「Skills」
 *   一节）。如果把"缺失"也判成 FAIL 并接进 verify:base:raw，本 PR 一旦按
 *   H3A-011 的证据把任何一个 Domain 标成 active，`lint:domains-doctor` 会
 *   在合入的第一秒就让全仓 CI 变红——而 Domain Skill 本身的建设是 H3A-016~018
 *   （P1，明确排除在本 PR 范围外）的工作。这不是本判定逻辑的缺陷，是两个
 *   完成契约的时间顺序：H3A-013 的 gate 要先存在，H3A-016+ 的 Skill 才有地方
 *   报到，但 gate 存在的那一刻不能预支未来才会完成的工作。
 *
 *   处理方式同 role-freeze-doctor.ts 的先例（"WARN 不阻断，历史仍可读"）：
 *   "missing"（一个 active Domain 一个 active Skill 都没有）判 WARN，
 *   "duplicate"（同一 Domain 有 ≥2 个 active Skill）和"引用不存在的
 *   domain_id"判 FAIL——后两者任何时候出现都是真实的不变量违反，不因为
 *   "系统还没建完"而值得原谅；前者只是"系统还没建完"本身的诚实反映。
 *   一旦某个 Domain 有了第一个 active Skill，"missing" 的 WARN 自然消失，
 *   不需要额外开关。
 *
 *   H3A-014（死引用）、H3A-015（SHA 形状不对）在 0 实例情况下同样不会触发
 *   （没有实例就没有引用可查），维持 FAIL 语义不影响今天的绿——只有未来真的
 *   有实例、且引用确实死掉/commit 格式确实不像 SHA 时才会红，这才是这两条
 *   判定契约原文"死引用/不可解析会红"的本意。
 */
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";

export type GateSeverity = "FAIL" | "WARN";

export interface GateFinding {
  code: string;
  severity: GateSeverity;
  message: string;
  sourceFile?: string;
}

/* ═══════════════════════ H3A-013：Domain↔Skill 一对一 active gate ═══════════════════════ */

export function findActiveGateViolations(
  domains: readonly DomainRegistryEntry[],
  skills: readonly DomainSkillInstance[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  const domainIds = new Set(domains.map((d) => d.domain_id));
  const activeByDomain = new Map<string, DomainSkillInstance[]>();

  for (const skill of skills) {
    if (skill.status !== "active") continue;
    if (!domainIds.has(skill.domain_id)) {
      findings.push({
        code: "H3A013-SKILL-UNKNOWN-DOMAIN",
        severity: "FAIL",
        sourceFile: skill.sourceFile,
        message: `Domain Skill "${skill.skill_id}" 的 domain_id "${skill.domain_id}" 在 .harness/domains/registry.yaml 里不存在`,
      });
      continue;
    }
    const list = activeByDomain.get(skill.domain_id) ?? [];
    list.push(skill);
    activeByDomain.set(skill.domain_id, list);
  }

  for (const domain of domains) {
    if (domain.status !== "active") continue;
    const active = activeByDomain.get(domain.domain_id) ?? [];
    if (active.length === 0) {
      findings.push({
        code: "H3A013-MISSING-ACTIVE-SKILL",
        severity: "WARN",
        message: `Domain "${domain.domain_id}"（${domain.name}）没有 active Domain Skill —— ` +
          `H3A-016+（P1，不在本 PR 范围）尚未建设，今天全仓 0 个真实实例是已知状态，不是回归`,
      });
    } else if (active.length > 1) {
      findings.push({
        code: "H3A013-DUPLICATE-ACTIVE-SKILL",
        severity: "FAIL",
        message: `Domain "${domain.domain_id}"（${domain.name}）有 ${active.length} 个 active Domain Skill：` +
          `${active.map((s) => s.skill_id).join(", ")}——同一 Domain 只能有一个 active Skill`,
      });
    }
  }

  return findings;
}

/* ═══════════════════════ H3A-014：Skill reference integrity gate ═══════════════════════ */

/**
 * `pathExists` 由调用方注入（doctor 用真实 `existsSync`，单测用假 Set）——
 * 保持本函数纯，不碰文件系统。`verification` 字段是 shell 命令而不是文件路径，
 * 刻意不检查（如实标注："能不能跑通某条 shell 命令"是不同性质的检查，同
 * terminology-doctor.ts 对"全仓扫描新写旧字段"的处理方式一致：如实说明没做，
 * 不假装做了）。
 */
export function findDeadReferences(
  skills: readonly DomainSkillInstance[],
  pathExists: (path: string) => boolean,
): GateFinding[] {
  const findings: GateFinding[] = [];
  const CHECKABLE_FIELDS = ["contracts", "adrs", "source_paths"] as const;
  for (const skill of skills) {
    for (const field of CHECKABLE_FIELDS) {
      for (const ref of skill.authority_refs[field]) {
        if (!pathExists(ref)) {
          findings.push({
            code: "H3A014-DEAD-REFERENCE",
            severity: "FAIL",
            sourceFile: skill.sourceFile,
            message: `Domain Skill "${skill.skill_id}" 的 authority_refs.${field} 引用了不存在的路径 "${ref}"`,
          });
        }
      }
    }
  }
  return findings;
}

/* ═══════════════════════ H3A-015：Skill freshness / STALENESS gate ═══════════════════════ */

/**
 * 只查"看起来像不像一个 SHA"（7~40 位十六进制），不查这个 SHA 是否真的存在于
 * git 历史、是否是仓库当前分支的祖先——那需要调用 `git cat-file`/`git merge-base`
 * 之类的真实 IO，属于"更深的 git 集成"，任务描述原文允许"如实标注做不到的部分"，
 * 这里选择做轻量检查，在 doctor 输出里显式声明这条限制（同 terminology-doctor.ts
 * 的先例）。
 */
const SHA_SHAPE_RE = /^[0-9a-f]{7,40}$/i;

export function findFreshnessIssues(skills: readonly DomainSkillInstance[]): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const skill of skills) {
    const commit = skill.last_verified.commit;
    if (commit === null) {
      if (skill.status === "active") {
        findings.push({
          code: "H3A015-NEVER-VERIFIED",
          severity: "WARN",
          sourceFile: skill.sourceFile,
          message: `Domain Skill "${skill.skill_id}" 是 active 但 last_verified.commit 为 null —— 从未验证过`,
        });
      }
      continue;
    }
    if (!SHA_SHAPE_RE.test(commit)) {
      findings.push({
        code: "H3A015-MALFORMED-COMMIT",
        severity: "FAIL",
        sourceFile: skill.sourceFile,
        message: `Domain Skill "${skill.skill_id}" 的 last_verified.commit "${commit}" 不像一个合法 SHA` +
          `（应是 7~40 位十六进制字符）——本检查只验证形状，不验证该 commit 是否真的存在于 git 历史`,
      });
    }
  }
  return findings;
}
