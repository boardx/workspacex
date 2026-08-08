/**
 * domain-orchestrator-binding.ts —— PROP-HARNESS-AGENT-001 H3A-022（Epic E2）：
 * "每个 Role 绑定一个 Domain 和一个 active Skill"。
 *
 * 依赖两条已落地的 schema（本条目的完成契约原文依赖列的正是这两个）：
 *   - H3A-010 `.harness/domains/registry.yaml`（domain-model.ts）——Domain 的
 *     owner 字段。
 *   - H3A-020 `.harness/agents/roles/*.yaml` 的 layer 派生（role-authorization.ts）
 *     ——谁是 domain_orchestrator。
 *
 * 真实数据的结构性事实（现场核实，不是假设）：
 *   1. `.harness/agents/roles/*.yaml` 今天只有 6 个持久角色文件，其中只有
 *      `coord-architecture`（kind: architecture-coordinator）是 layer:
 *      domain_orchestrator——`coord-chat-e2e`/`coord-agent-auth` 这两个在
 *      domains/registry.yaml 里当 owner 的身份，只登记在
 *      `.harness/agents/registry.yaml` 的 `agents:` 数组里（kind:
 *      module-coordinator），没有对应的持久角色文件。这不是本条目的 bug，
 *      是 E0 inventory 已经记录的既有状态——"持久角色文件"和"registry 身份
 *      登记"是两个粒度不同的东西，H3A-020 的 6 个角色文件只覆盖了一部分。
 *      所以"谁是 domain_orchestrator 身份"要看 registry.yaml 的 kind，不能
 *      只看 6 个角色文件（那会漏掉 coord-chat-e2e/coord-agent-auth）。
 *   2. `domains/registry.yaml` 文件头已经如实写明两个已知结构问题：
 *      - `DOM-AGENT-SKILL-DIRECTORY` 的 owner 是 null（真实冲突，未裁决）。
 *      - `coord-chat-e2e` 同时拥有 DOM-CHAT/DOM-CANVAS-DIAGRAM/
 *        DOM-E2E-RELEASE-READINESS 三个 Domain（"一人覆盖三个 Domain"）。
 *      - `DOM-PLATFORM`/`DOM-AI-RUNTIME` 的 owner 是 kind:worker 身份
 *        （dev-platform-baseline/dev-ai-runtime），根本不是 domain_orchestrator
 *        层，因为这两个 Domain 今天没有 coordinator 层。
 *   这三类都是**已知、文档化、尚未裁决**的既有状态，不是这次改动引入的新
 *   回归——按本仓库反复验证过的先例（role-authorization.ts 的 H3A-029、
 *   domain-skill-gates.ts 的 H3A-013），已知过渡态用 WARN 保持可见，不用
 *   FAIL 把仓库堵死。真正的结构性错误（owner 指向一个根本不存在的身份、
 *   一个 Domain 绑了 2 个 active Skill 产生歧义）才是 FAIL。
 *
 * 校验风格延续 domain-model.ts/role-authorization.ts 的先例：手写纯函数，
 * 累积上报全部问题，不 fail-fast；IO 在 role-authorization-doctor.ts。
 */

import type { DomainRegistryEntry } from "./domain-model";
import type { DomainSkillInstance } from "./domain-skill-model";
import type { Finding, LayeredRole } from "./role-authorization";

/* ═══════════ H3A-022a：owner 身份必须真实存在、且今天是 domain_orchestrator 层 ═══════════ */

/**
 * @param domains H3A-010 校验通过的 Domain Registry entries。
 * @param orchestratorNames 今天真实是 layer:domain_orchestrator 的身份名集合
 *   （角色文件 + registry.yaml agents[] 的 kind 派生，两个来源的并集——见文件头注释①）。
 * @param allKnownIdentityNames 今天在 registry.yaml agents[]/reviewers[] 或角色
 *   文件里出现过的全部身份名（不分层级），用来区分"owner 压根不存在"（FAIL）
 *   和"owner 存在但不是 domain_orchestrator 层"（WARN，已知结构问题②）。
 */
export function checkDomainOwnerIdentity(
  domains: readonly DomainRegistryEntry[],
  orchestratorNames: ReadonlySet<string>,
  allKnownIdentityNames: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const domain of domains) {
    if (domain.owner === null) {
      findings.push({
        code: "H3A022-DOMAIN-NO-OWNER",
        severity: "WARN",
        sourceFile: ".harness/domains/registry.yaml",
        message: `Domain "${domain.domain_id}"（${domain.name}）owner 为 null——今天没有唯一权威 owner，需人类确认（见文件头 H3A-011 说明），不视为本次改动引入的新回归`,
      });
      continue;
    }
    if (!allKnownIdentityNames.has(domain.owner)) {
      findings.push({
        code: "H3A022-OWNER-UNKNOWN-IDENTITY",
        severity: "FAIL",
        sourceFile: ".harness/domains/registry.yaml",
        message: `Domain "${domain.domain_id}" 的 owner "${domain.owner}" 在 registry.yaml 的 agents[]/reviewers[] 和角色文件里都找不到——引用了一个不存在的身份`,
      });
      continue;
    }
    if (!orchestratorNames.has(domain.owner)) {
      findings.push({
        code: "H3A022-OWNER-NOT-ORCHESTRATOR-LAYER",
        severity: "WARN",
        sourceFile: ".harness/domains/registry.yaml",
        message: `Domain "${domain.domain_id}" 的 owner "${domain.owner}" 是已登记身份，但今天不是 layer:domain_orchestrator（该 Domain 没有 coordinator 层，只有直接 worker）——E0 inventory 已记录的结构问题，不是新回归`,
      });
    }
  }
  return findings;
}

/* ═══════════ H3A-022b："一个 Domain" —— 单个 orchestrator 不应绑定多个 Domain ═══════════ */

export function checkOneDomainPerOrchestrator(domains: readonly DomainRegistryEntry[]): Finding[] {
  const byOwner = new Map<string, string[]>();
  for (const domain of domains) {
    if (domain.owner === null) continue;
    const list = byOwner.get(domain.owner) ?? [];
    list.push(domain.domain_id);
    byOwner.set(domain.owner, list);
  }

  const findings: Finding[] = [];
  for (const [owner, domainIds] of byOwner) {
    if (domainIds.length <= 1) continue;
    findings.push({
      code: "H3A022-ORCHESTRATOR-MULTIPLE-DOMAINS",
      severity: "WARN",
      sourceFile: ".harness/domains/registry.yaml",
      message:
        `身份 "${owner}" 同时是 ${domainIds.length} 个 Domain 的 owner（${domainIds.join(", ")}）——` +
        `完成契约要求"每个 Role 绑定一个 Domain"，这是 domains/registry.yaml 文件头已经如实记录的既有结构问题，不是新回归，` +
        `裁决（拆分 Domain 还是拆分 owner 职责）需要人类确认`,
    });
  }
  return findings;
}

/* ═══════════ H3A-022c：持久角色文件里的 domain_orchestrator 必须能在 registry 里找到自己名下的 Domain ═══════════ */

export function checkOrchestratorRoleHasDomain(
  roles: readonly LayeredRole[],
  domains: readonly DomainRegistryEntry[],
): Finding[] {
  const ownedByName = new Set(domains.filter((d) => d.owner !== null).map((d) => d.owner as string));
  const findings: Finding[] = [];
  for (const role of roles) {
    if (role.layer !== "domain_orchestrator") continue;
    if (!ownedByName.has(role.name)) {
      findings.push({
        code: "H3A022-ORCHESTRATOR-ROLE-NO-DOMAIN",
        severity: "FAIL",
        sourceFile: role.sourceFile,
        message: `角色 "${role.name}"（layer: domain_orchestrator，来自持久角色文件）在 .harness/domains/registry.yaml 里没有任何 Domain 把它登记为 owner——Domain Orchestrator Role 必须绑定一个 Domain`,
      });
    }
  }
  return findings;
}

/* ═══════════ H3A-022d："一个 active Skill" —— 每个有 owner 的 Domain 应绑定恰好一个 active Skill ═══════════ */

export function checkActiveSkillBinding(
  domains: readonly DomainRegistryEntry[],
  skills: readonly DomainSkillInstance[],
): Finding[] {
  const findings: Finding[] = [];
  for (const domain of domains) {
    if (domain.owner === null || domain.status !== "active") continue; // 无 owner 的 Domain 已由 H3A022-DOMAIN-NO-OWNER 覆盖，这里不重复报

    const activeSkills = skills.filter((s) => s.domain_id === domain.domain_id && s.status === "active");
    if (activeSkills.length === 0) {
      findings.push({
        code: "H3A022-NO-ACTIVE-SKILL",
        severity: "WARN",
        sourceFile: ".harness/domains/registry.yaml",
        message: `Domain "${domain.domain_id}" 没有绑定任何 status:active 的 Domain Skill 实例——今天全仓 0 个真实 TPL-MOD-001 实例是 H3A-002 inventory 已确认的已知状态（H3A-016+ 尚未建设），不是本次改动引入的回归`,
      });
    } else if (activeSkills.length > 1) {
      findings.push({
        code: "H3A022-MULTIPLE-ACTIVE-SKILLS",
        severity: "FAIL",
        sourceFile: ".harness/domains/registry.yaml",
        message:
          `Domain "${domain.domain_id}" 同时绑定了 ${activeSkills.length} 个 status:active 的 Domain Skill 实例` +
          `（${activeSkills.map((s) => s.instance_id).join(", ")}）——"一个 Domain 一个 active Skill" 要求唯一，出现歧义`,
      });
    }
  }
  return findings;
}
