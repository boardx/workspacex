/**
 * task-assignment-root-domain-gate.ts —— PROP-HARNESS-AGENT-001 H3A-031（Epic E3）：
 * "Root→Domain Task Assignment gate | assignee domain/scope/skill/依赖有效"。
 *
 * 范围（跟 H3A-030/H3A-032 的分工，避免越界做别人的事）：
 *   - 只判定 `assigned_by` 解析为 Root Orchestrator（layer: root_orchestrator，
 *     今天就是 `coord-main`）的 Task Assignment。不是 Root 发出的实例（比如
 *     Domain→Worker）不在本 gate 范围，交给 H3A-032。
 *   - `assigned_by` 字段命名虽然是 Proposal §10.3 的 "<directory-main-agent-id>"
 *     语义，但今天没有 Directory ULID 解析层（H3A-040+ 尚未开工，见
 *     PROP-HARNESS-AGENT-001.md §10.2），本 gate 只能按字面值与
 *     registry.yaml/角色文件里已登记的 root_orchestrator 身份 id 比对——
 *     同 H3A-030 fixture 用 "coord-main" 字面值做 assigned_by 的先例
 *     （见 task-assignment-model.test.ts）。这不是本条目能解决的落差，
 *     如实按字面走，不假装存在一套身份解析。
 *
 * 五条判定对应完成契约原文：
 *   1. assignee_role 真实存在，且 layer 是 domain_orchestrator——复用
 *      role-authorization.ts 的 KIND_TO_LAYER 派生结果 + registry.yaml
 *      agents[] 的并集来源（同 role-authorization-doctor.ts 里 H3A-022
 *      "orchestratorNames" 的计算方式，H3A-022 已经解决过"角色文件 +
 *      registry agents[] 两个来源取并集"这个模式，这里直接复用同一个
 *      并集，不重新踩坑）。
 *      —— 例外：如果 assignee_role 是已登记的 reviewer 身份（layer 实际是
 *      specialist_worker），按 §6.4 / H3A-029 的先例，Root 直派独立
 *      reviewer/verifier 是允许的模式，本 gate 判 WARN 而不是 FAIL（同
 *      role-authorization.ts checkRootDirectL3Exception 的 WARN 先例：
 *      已知、文档化、Proposal 自己允许的过渡态用 WARN 保持可见，不用 FAIL
 *      把仓库堵死）。
 *   2. assignee_role 所属 Domain（.harness/domains/registry.yaml 里
 *      owner === assignee_role）真实存在——找不到判 FAIL：domain_orchestrator
 *      身份存在但没有 Domain 承认它是 owner，是结构性错误，不是过渡态。
 *      如果同一 assignee_role 同时是多个 Domain 的 owner（H3A-022b 已知的
 *      "一人覆盖多个 Domain"结构问题，尚未裁决），本 gate 不在这里重复判
 *      FAIL/WARN——那是 H3A-022b 的事——但要选一组 candidate Domain 继续做
 *      skill/scope 检查：用全部候选 Domain 的 areas 并集，保守判定，避免
 *      对已知未裁决的结构问题产生级联误报。
 *   3. skill_refs 理论上应属于该 Domain——今天全仓 0 个真实 TPL-MOD-001
 *      Domain Skill 实例（H3A-002/H3A-012 已确认）。分两种情况：
 *        a. skill_ref 在全仓 Domain Skill 实例语料库里查无——WARN，
 *           如实标注"今天没有数据可判定"，不是违规。
 *        b. skill_ref 查到了但属于别的 Domain——FAIL，这是真实的归属错误，
 *           跟"语料库是否完整"无关。
 *   4. scope 是否越权——Proposal 原文没有给出机器可判定的定义（完成契约
 *      要求原文如实指出这一点）。本 gate 只做一层启发式：scope.include 的
 *      每一项若不是候选 Domain areas[] 里的字面值，判 WARN（不是 FAIL——
 *      scope.include 也可能合法地是路径模式而不是 area 名，本检查无法区分，
 *      判 FAIL 会有假阳性风险；诚实的做法是把它当"可疑信号"WARN 出来，不是
 *      "确认违规"）。scope.exclude 同理不检查——Proposal 也没定义 exclude
 *      的越权语义，如实不检查，不编造。
 *   5. dependencies 引用的 task_id 是否存在——只在 Root 发出的语义范围内查，
 *      对照调用方传入的已扫描语料库（.harness/tasks/ 全部实例的 instance_id
 *      集合）。今天该目录是空的（H3A-030 刚建的存放约定），语料库只有 0-N 个
 *      instance_id，dependencies 非空但引用不到的才报 FAIL——同 domain-skill-
 *      gates.ts H3A-014 死引用的先例（"语料库不完整"和"引用了确实不存在的
 *      东西"是两回事，后者任何时候出现都是真实违反）。
 *
 * 校验风格延续 domain-model.ts/role-authorization.ts/domain-orchestrator-
 * binding.ts 的先例：手写纯函数，累积上报全部问题，不 fail-fast；IO 在
 * task-assignment-doctor.ts。
 */
import type { TaskAssignment } from "./task-assignment-model";
import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";
import type { Finding } from "./role-authorization";

export interface RootDomainGateContext {
  /** 今天字面上等于 root_orchestrator 层身份 id 的集合（见文件头「范围」①）。 */
  rootOrchestratorIds: ReadonlySet<string>;
  /** 今天字面上等于 domain_orchestrator 层身份 name 的集合（角色文件 + registry agents[] 并集）。 */
  domainOrchestratorNames: ReadonlySet<string>;
  /** registry.yaml reviewers[] 的 id 集合，用于判定「Root 直派 reviewer」例外（判①）。 */
  reviewerIds: ReadonlySet<string>;
  /** 今天在 registry.yaml agents[]/reviewers[] 或角色文件里出现过的全部身份 name，不分层级。 */
  allKnownIdentityNames: ReadonlySet<string>;
  domains: readonly DomainRegistryEntry[];
  domainSkills: readonly DomainSkillInstance[];
  /** 已扫描的 .harness/tasks/ 语料库里全部 Task Assignment 的 instance_id 集合（用于判⑤）。 */
  allTaskIds: ReadonlySet<string>;
}

export function checkRootToDomainAssignment(
  assignment: TaskAssignment,
  ctx: RootDomainGateContext,
): Finding[] {
  const findings: Finding[] = [];
  const src = assignment.sourceFile;

  if (!ctx.rootOrchestratorIds.has(assignment.assigned_by)) {
    // 不是 Root 发出的 Task Assignment——不在本 gate（Root→Domain）范围内，
    // 如实跳过，不代表"检查过了没问题"，只是"这条不归本 gate 判"。
    return findings;
  }

  // 判⑤：dependencies 引用的 task_id 是否存在——跟角色/Domain 解析无关，独立判定。
  for (const dep of assignment.dependencies) {
    if (!ctx.allTaskIds.has(dep)) {
      findings.push({
        code: "H3A031-DEPENDENCY-NOT-FOUND",
        severity: "FAIL",
        sourceFile: src,
        message: `dependencies 引用的 task_id "${dep}" 在已扫描的 .harness/tasks/ 语料库里找不到——依赖了一个不存在的 Task Assignment`,
      });
    }
  }

  // 判①a：assignee_role 真实存在。
  if (!ctx.allKnownIdentityNames.has(assignment.assignee_role)) {
    findings.push({
      code: "H3A031-ASSIGNEE-ROLE-UNKNOWN",
      severity: "FAIL",
      sourceFile: src,
      message: `assignee_role "${assignment.assignee_role}" 在 registry.yaml 的 agents[]/reviewers[] 和角色文件里都找不到——引用了一个不存在的身份`,
    });
    return findings; // 身份都不存在，domain/skill/scope 检查无对象可比对，避免连锁误报
  }

  // 判①b：layer 是 domain_orchestrator。
  if (!ctx.domainOrchestratorNames.has(assignment.assignee_role)) {
    if (ctx.reviewerIds.has(assignment.assignee_role)) {
      findings.push({
        code: "H3A031-ROOT-DIRECT-REVIEWER",
        severity: "WARN",
        sourceFile: src,
        message:
          `Root 直派 "${assignment.assignee_role}"（reviewer 身份），layer 不是 domain_orchestrator——` +
          `§6.4 允许 Root 直派独立 reviewer/verifier，这是本 gate（Root→Domain）范围外的合法模式，不判违规，仅如实记录`,
      });
    } else {
      findings.push({
        code: "H3A031-ASSIGNEE-NOT-DOMAIN-ORCHESTRATOR",
        severity: "FAIL",
        sourceFile: src,
        message: `assignee_role "${assignment.assignee_role}" 是已登记身份，但今天 layer 不是 domain_orchestrator——Root→Domain Task Assignment 必须指向一个 Domain Orchestrator 身份`,
      });
    }
    return findings; // 不是指向 domain orchestrator，domain/skill/scope 检查无对象可比对
  }

  // 判②：assignee_role 所属 Domain 真实存在。
  const ownedDomains = ctx.domains.filter((d) => d.owner === assignment.assignee_role);
  if (ownedDomains.length === 0) {
    findings.push({
      code: "H3A031-NO-DOMAIN-FOR-ASSIGNEE",
      severity: "FAIL",
      sourceFile: src,
      message: `assignee_role "${assignment.assignee_role}" 是 domain_orchestrator，但 .harness/domains/registry.yaml 里没有任何 Domain 把它登记为 owner——找不到它管辖的 Domain`,
    });
    return findings; // 找不到 domain，skill/scope 检查无 domain 可比对
  }

  const candidateDomainIds = new Set(ownedDomains.map((d) => d.domain_id));
  const candidateAreas = new Set(ownedDomains.flatMap((d) => d.areas));

  // 判③：skill_refs 理论上应属于该 Domain。
  for (const skillId of assignment.skill_refs) {
    const found = ctx.domainSkills.find((s) => s.skill_id === skillId);
    if (!found) {
      findings.push({
        code: "H3A031-SKILL-REF-UNVERIFIABLE",
        severity: "WARN",
        sourceFile: src,
        message: `skill_ref "${skillId}" 在全仓 Domain Skill 实例语料库里找不到——今天全仓 0 个真实 TPL-MOD-001 实例是已知状态（H3A-002/H3A-012 已确认），无法核实归属，不判违规`,
      });
    } else if (!candidateDomainIds.has(found.domain_id)) {
      findings.push({
        code: "H3A031-SKILL-REF-WRONG-DOMAIN",
        severity: "FAIL",
        sourceFile: src,
        message: `skill_ref "${skillId}" 属于 Domain "${found.domain_id}"，不属于 assignee_role "${assignment.assignee_role}" 管辖的 Domain（${[...candidateDomainIds].join(", ")}）`,
      });
    }
  }

  // 判④：scope.include 越权（启发式，见文件头注释——只做字面 area 名匹配）。
  for (const item of assignment.scope.include) {
    if (!candidateAreas.has(item)) {
      findings.push({
        code: "H3A031-SCOPE-AREA-MISMATCH",
        severity: "WARN",
        sourceFile: src,
        message:
          `scope.include 项 "${item}" 不在 assignee_role "${assignment.assignee_role}" 管辖 Domain 的 areas[]` +
          `（${[...candidateAreas].join(", ") || "(空)"}）里——本检查只做字面 area 名匹配，不解析路径模式，` +
          `可能有假阳性；"scope 越权"的机器可判定定义 Proposal 原文未给出，如实标为 WARN 而非 FAIL`,
      });
    }
  }

  return findings;
}

export function checkRootToDomainAssignments(
  assignments: readonly TaskAssignment[],
  ctx: RootDomainGateContext,
): Finding[] {
  return assignments.flatMap((a) => checkRootToDomainAssignment(a, ctx));
}
