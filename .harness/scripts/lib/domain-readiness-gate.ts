/**
 * domain-readiness-gate.ts —— PROP-HARNESS-AGENT-001 H3A-019（Epic E1）：
 * "Domain readiness gate | 011–015 | Role/Skill/数据源缺失时 Task Assignment
 * 保持 UNKNOWN/blocked"。
 *
 * 支撑原文（PROP-HARNESS-AGENT-001.md §6.4）："当目标 Domain 缺少 active
 * Domain Role、active Domain Skill 或健康数据源时，Root Orchestrator 将
 * Task Assignment 保持在 `blocked/UNKNOWN` 并请求修复，不能静默退化为 Root
 * 自己实现。"
 *
 * 这是一条**跨表 gate**：输入 Domain Registry（H3A-010/011）+ Domain Skill
 * 实例（H3A-012/013）+ Task Assignment 实例（H3A-030），输出对每个引用了某个
 * Domain 的 Task Assignment 判定"ready"或"not ready（附具体缺失原因）"。
 *
 * 三层判定，逐条复用既有结论，不重新造轮子：
 *
 *   1. **Role 缺失**——同 H3A-022a（domain-orchestrator-binding.ts
 *      `checkDomainOwnerIdentity`）的两种情况：owner 为 null（今天没有唯一
 *      权威 owner，需人类确认）判 WARN；owner 是已登记身份集合里查无的字符串
 *      （引用了一个不存在的身份）判 FAIL——这是真实的结构性错误，不是过渡态。
 *      刻意不在这里判"owner 存在但不是 domain_orchestrator 层"（H3A022-
 *      OWNER-NOT-ORCHESTRATOR-LAYER）——完成契约原文只要求"Role 必须真实
 *      存在"，层级归属正确性是 H3A-022c 的事，本 gate 不越界重复判。
 *
 *   2. **Skill 缺失**——同 H3A-013（domain-skill-gates.ts
 *      `findActiveGateViolations`）"缺失 active Skill" WARN 的判定条件：
 *      该 Domain 没有任何 status:active 的 Domain Skill 实例。今天全仓 0 个
 *      真实 TPL-MOD-001 实例（H3A-002/H3A-012 已确认），这是已知状态，WARN
 *      不阻断——但本条目往前一步：一个 Task Assignment 若指向这样的 Domain，
 *      该 Task Assignment 本身要被标记为未就绪，不能假装可以正常派工
 *      （这正是 H3A-019 相对 H3A-013 新增的部分：H3A-013 只管 Domain 本身，
 *      不知道有没有 Task Assignment 在依赖它）。
 *      刻意不判"重复 active Skill"（H3A013-DUPLICATE-ACTIVE-SKILL FAIL）——
 *      那是 Domain 本身的结构错误，跟"这个 Domain 有没有就绪"不冲突（重复
 *      也是有 active Skill，只是有歧义），已由 H3A-013 覆盖，不重复判。
 *
 *   3. **数据源缺失**——Proposal §6.4 原文只写"健康数据源"，没有给出机器
 *      可判定的精确定义（这是完成契约本身要求"如实指出"的落差，同
 *      task-assignment-root-domain-gate.ts 判④对"scope 越权"没有精确定义
 *      的处理方式一致）。本条目的解释选择：Domain 的 `contracts`/
 *      `verification`（H3A-010 domain-model.ts 已有的两个字段）**均为空
 *      数组**时，视为"没有可执行的验证锚点"，判 WARN。选择"均为空"而不是
 *      "任一为空"，是因为 contracts 和 verification 是两种不同性质的锚点
 *      （前者是契约束引用，后者是可执行命令）——一个 Domain 完全可能只挂
 *      了其中一种就足以证明"有健康数据源"，只有两者都缺失才是真正意义上
 *      "没有任何数据源"。这是本条目对"数据源"一词的合理理解，不是 Proposal
 *      逐字定义，如实标注。
 *
 * 严重度设计：FAIL 对应"确认的结构性违反"（role 引用了不存在的身份）；WARN
 * 对应"已知的未完成状态，无法确认但也未证伪"（owner 为 null、skill 缺失、
 * 数据源缺失）——同本仓库其余跨表 gate 的一贯先例（domain-skill-gates.ts、
 * domain-orchestrator-binding.ts、task-assignment-root-domain-gate.ts）。
 * Task Assignment 级别的 finding 取该 Domain 全部未就绪原因里最严重的一个：
 * 任一原因是 FAIL，Task Assignment 级 finding 就是 FAIL（"blocked"）；否则
 * 是 WARN（"UNKNOWN"）——对应完成契约原文"保持 UNKNOWN/blocked"的两种表述。
 *
 * assignee_role → Domain 的解析口径同 task-assignment-root-domain-gate.ts
 * 判②："Domain owner === assignee_role"。跟那条 gate 不同的是，本 gate 不
 * 限定 assigned_by 必须是 root_orchestrator——一个 Task Assignment 只要
 * assignee_role 是某个 Domain 的 owner，不管是谁派工的，都要检查这个 Domain
 * 是否就绪（readiness 是 Domain 自身的属性，不是"谁派的工"决定的）。如果
 * assignee_role 不是任何 Domain 的 owner（比如是被 Domain Orchestrator 派工
 * 的 Specialist Worker），本 gate 不适用，如实跳过——不代表"检查过没问题"，
 * 只是"这条不归本 gate 判"（同 checkRootToDomainAssignment 对非 root 派工
 * 的处理方式）。
 *
 * 校验风格延续 domain-skill-gates.ts/domain-orchestrator-binding.ts/
 * task-assignment-root-domain-gate.ts 的先例：手写纯函数，累积上报全部
 * 问题，不 fail-fast；IO 在 task-assignment-doctor.ts。
 */
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";
import type { TaskAssignment } from "./task-assignment-model";
import type { Finding } from "./role-authorization";

export type ReadinessSeverity = "FAIL" | "WARN";

export interface DomainReadinessReason {
  code: string;
  severity: ReadinessSeverity;
  message: string;
}

export interface DomainReadiness {
  domain_id: string;
  ready: boolean;
  reasons: DomainReadinessReason[];
}

/**
 * 对 Domain Registry 里的每一个 entry 计算就绪状态。`allKnownIdentityNames`
 * 同 role-authorization-doctor.ts H3A-022 的口径：角色文件 name + registry.yaml
 * agents[]/reviewers[] id 的并集。
 */
export function computeDomainReadiness(
  domains: readonly DomainRegistryEntry[],
  skills: readonly DomainSkillInstance[],
  allKnownIdentityNames: ReadonlySet<string>,
): DomainReadiness[] {
  return domains.map((domain) => {
    const reasons: DomainReadinessReason[] = [];

    // 判①：Role 缺失——同 H3A-022a checkDomainOwnerIdentity 的判定条件。
    if (domain.owner === null) {
      reasons.push({
        code: "H3A019-ROLE-NO-OWNER",
        severity: "WARN",
        message: `Domain "${domain.domain_id}"（${domain.name}）owner 为 null——今天没有唯一权威 owner（同 H3A-022a H3A022-DOMAIN-NO-OWNER 判定），Role 未就绪`,
      });
    } else if (!allKnownIdentityNames.has(domain.owner)) {
      reasons.push({
        code: "H3A019-ROLE-UNKNOWN-IDENTITY",
        severity: "FAIL",
        message: `Domain "${domain.domain_id}"（${domain.name}）的 owner "${domain.owner}" 不是已登记身份（同 H3A-022a H3A022-OWNER-UNKNOWN-IDENTITY 判定）——Role 缺失是确认的结构性错误`,
      });
    }

    // 判②：Skill 缺失——同 H3A-013 findActiveGateViolations「缺失 active Skill」的判定条件。
    const activeSkills = skills.filter((s) => s.domain_id === domain.domain_id && s.status === "active");
    if (activeSkills.length === 0) {
      reasons.push({
        code: "H3A019-SKILL-MISSING",
        severity: "WARN",
        message: `Domain "${domain.domain_id}"（${domain.name}）没有 active Domain Skill（同 H3A-013 H3A013-MISSING-ACTIVE-SKILL 判定）——今天全仓 0 个真实实例是已知状态（H3A-016+ 尚未建设），Skill 未就绪`,
      });
    }

    // 判③：数据源缺失——Proposal §6.4「健康数据源」无机器可判定的精确定义，
    // 见文件头注释③本条目的解释选择：contracts[]、verification[] 均为空。
    if (domain.contracts.length === 0 && domain.verification.length === 0) {
      reasons.push({
        code: "H3A019-DATA-SOURCE-EMPTY",
        severity: "WARN",
        message: `Domain "${domain.domain_id}"（${domain.name}）的 contracts[]、verification[] 均为空数组——没有可执行的验证锚点，数据源未就绪（Proposal §6.4 只写"健康数据源"未给出机器判定，这是本条目对该词的解释选择，如实标注）`,
      });
    }

    return { domain_id: domain.domain_id, ready: reasons.length === 0, reasons };
  });
}

/** 把 computeDomainReadiness 的结果整理成 domain_id → DomainReadiness 的查找表。 */
export function buildReadinessMap(readiness: readonly DomainReadiness[]): ReadonlyMap<string, DomainReadiness> {
  return new Map(readiness.map((r) => [r.domain_id, r]));
}

/**
 * 把 Domain 就绪状态投影到 Task Assignment——assignee_role → Domain 的解析
 * 口径同 task-assignment-root-domain-gate.ts 判②："Domain owner === assignee_role"
 * （见文件头「assignee_role → Domain 的解析口径」一节）。
 */
export function checkTaskAssignmentReadiness(
  assignments: readonly TaskAssignment[],
  domains: readonly DomainRegistryEntry[],
  readinessByDomain: ReadonlyMap<string, DomainReadiness>,
): Finding[] {
  const findings: Finding[] = [];

  for (const assignment of assignments) {
    const ownedDomains = domains.filter((d) => d.owner === assignment.assignee_role);
    if (ownedDomains.length === 0) {
      // assignee_role 不是任何 Domain 的 owner——本 gate 不适用（同
      // checkRootToDomainAssignment 对超出范围输入的处理：如实跳过，不代表
      // "检查过没问题"）。
      continue;
    }

    for (const domain of ownedDomains) {
      const readiness = readinessByDomain.get(domain.domain_id);
      if (!readiness || readiness.ready) continue;

      const worst: ReadinessSeverity = readiness.reasons.some((r) => r.severity === "FAIL") ? "FAIL" : "WARN";
      findings.push({
        code: "H3A019-TASK-ASSIGNMENT-NOT-READY",
        severity: worst,
        sourceFile: assignment.sourceFile,
        message:
          `Task Assignment "${assignment.instance_id}"（assignee_role "${assignment.assignee_role}"）指向的 Domain ` +
          `"${domain.domain_id}" 未就绪，保持 ${worst === "FAIL" ? "blocked" : "UNKNOWN"}` +
          `（Proposal §6.4 原文"保持在 blocked/UNKNOWN 并请求修复，不能静默退化为 Root 自己实现"）——原因：` +
          readiness.reasons.map((r) => `[${r.code}] ${r.message}`).join("；"),
      });
    }
  }

  return findings;
}
