// task-assignment-doctor.ts — H3A-030/031/032（PROP-HARNESS-AGENT-001 Epic E3）
// 的仓库侧入口。
//
// pnpm harness task-assignment doctor
//
// 判定逻辑分三层，都是纯函数（喂 fixture 单测），本文件只做 IO：
//   - H3A-030：单表 schema——扫 `.harness/tasks/*.yaml`（本 PR 建立的存放约定，
//     见该目录的 README.md），挑出 template_id === "TPL-TSK-001" 的实例 →
//     交给 validateTaskAssignment。
//   - H3A-031：Root→Domain 跨表 gate（lib/task-assignment-root-domain-gate.ts）
//     ——只对 schema 校验通过的实例跑，复用 role-authorization-doctor.ts 已经
//     踩过坑修好的角色文件/registry 读取逻辑和 domains-doctor.ts 的 Domain
//     Registry/Domain Skill 读取逻辑，不重新发明一遍。
//   - H3A-032：Domain→Worker 跨表 gate（lib/domain-worker-task-assignment-gate.ts）
//     ——不越领域/不越配额/不越权限三条，同样只对 schema 校验通过的实例跑。
// 同 H3A-022 的先例：新检查并入既有 doctor 入口，不新开 CLI 子命令。同
// domains-doctor.ts 的分层方式：本文件只管"从哪读、输出成什么退出码"，不含
// 判定逻辑本身。
//
// 今天预期扫到 0 份实例——Epic E3 在 H3A-030 之前完全未开工，这是仓库的真实
// 状态，不是 bug（同 domains-doctor.ts 落地时 0 个 Domain Skill 实例的先例）。
// 0 实例意味着 H3A-031/032 的跨表 gate 今天都不会触发任何 finding——这是诚实
// 的现状，不是 gate 没接上（各自 PR 描述里的真实反证会现场注入违规实例证明
// gate 真的会红）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateTaskAssignment, looksLikeTaskAssignment, type TaskAssignment } from "./lib/task-assignment-model";
import {
  checkRootToDomainAssignments,
  type RootDomainGateContext,
} from "./lib/task-assignment-root-domain-gate";
import { KIND_TO_LAYER, validateRoleFiles, type LayeredRole } from "./lib/role-authorization";
import {
  checkDomainScope,
  checkWorkerBudgetQuota,
  checkAssigneeAuthorityCeiling,
} from "./lib/domain-worker-task-assignment-gate";
import { readRoleFiles, readRegistry } from "./role-authorization-doctor";
import { validateDomainRegistry, type DomainRegistryEntry } from "./lib/domain-model";
import { DOMAIN_REGISTRY_PATH, readYaml as readDomainYaml, scanDomainSkillInstances } from "./domains-doctor";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const TASKS_DIR = join(REPO_ROOT, ".harness", "tasks");

function scanTaskAssignments(): { instances: TaskAssignment[]; failures: { sourceFile: string; message: string }[] } {
  const instances: TaskAssignment[] = [];
  const failures: { sourceFile: string; message: string }[] = [];
  if (!existsSync(TASKS_DIR)) return { instances, failures };

  const files = readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  for (const file of files) {
    const filePath = join(TASKS_DIR, file);
    const relPath = relative(REPO_ROOT, filePath);
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(filePath, "utf8"));
    } catch (e) {
      failures.push({ sourceFile: relPath, message: `YAML 解析失败：${(e as Error).message}` });
      continue;
    }
    if (!looksLikeTaskAssignment(parsed)) continue; // 不声明 TPL-TSK-001，不关我们的事

    const result = validateTaskAssignment(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
    } else {
      failures.push({ sourceFile: relPath, message: result.issues.map((i) => `${i.path}: ${i.message}`).join("；") });
    }
  }

  return { instances, failures };
}

/**
 * H3A-031 的跨表 gate 需要角色/registry/Domain 三类上下文，构造失败（读不到或
 * 解析不了权威文件）时按 fail-closed 处理——同 role-authorization-doctor.ts
 * 里 H3A-022 读 registry/domains 失败时的先例：宁可 UNKNOWN 拒绝下判断，不能
 * 在权威源缺失的情况下默默放行。
 */
function buildRootDomainGateContext(allTaskIds: ReadonlySet<string>): { ctx: RootDomainGateContext | null; error: string | null } {
  const { error: registryError, agents, agentIds, reviewerIds } = readRegistry();
  if (registryError) return { ctx: null, error: `registry.yaml ${registryError}` };

  let roles: LayeredRole[];
  try {
    const roleFiles = readRoleFiles();
    const { roles: validated, findings: schemaFindings } = validateRoleFiles(roleFiles);
    if (schemaFindings.length > 0) {
      // 角色文件本身 schema 不合法——那是 role-authorization doctor 的事，
      // 本 gate 不能在权威源结构损坏的情况下继续下判断。
      return { ctx: null, error: `角色文件 schema 校验失败（应由 role-authorization doctor 先修）：${schemaFindings.map((f) => f.message).join("；")}` };
    }
    roles = validated;
  } catch (e) {
    return { ctx: null, error: `读取角色文件失败：${(e as Error).message}` };
  }

  const { parsed: domainRegRaw, error: domainRegErr } = readDomainYaml(DOMAIN_REGISTRY_PATH);
  if (domainRegErr) return { ctx: null, error: `.harness/domains/registry.yaml ${domainRegErr}` };
  const domainRegResult = validateDomainRegistry(domainRegRaw);
  if (!domainRegResult.ok) {
    return { ctx: null, error: `.harness/domains/registry.yaml 校验失败（应由 domains doctor 先修）` };
  }
  const domains: DomainRegistryEntry[] = domainRegResult.value!.entries;
  const { instances: domainSkills } = scanDomainSkillInstances();

  // 同 role-authorization-doctor.ts H3A-022 的先例：root/domain orchestrator
  // 层身份要看角色文件 + registry.yaml agents[] 两个来源的并集，避免漏掉只
  // 登记在 registry.yaml 里、没有持久角色文件的身份（今天的 coord-chat-e2e/
  // coord-agent-auth 就是这种）。
  const rootOrchestratorIds = new Set<string>([
    ...roles.filter((r) => r.layer === "root_orchestrator").map((r) => r.name),
    ...agents.filter((a) => KIND_TO_LAYER[a.kind] === "root_orchestrator").map((a) => a.id),
  ]);
  const domainOrchestratorNames = new Set<string>([
    ...roles.filter((r) => r.layer === "domain_orchestrator").map((r) => r.name),
    ...agents.filter((a) => KIND_TO_LAYER[a.kind] === "domain_orchestrator").map((a) => a.id),
  ]);
  const allKnownIdentityNames = new Set<string>([...roles.map((r) => r.name), ...agentIds, ...reviewerIds]);

  const ctx: RootDomainGateContext = {
    rootOrchestratorIds,
    domainOrchestratorNames,
    reviewerIds,
    allKnownIdentityNames,
    domains,
    domainSkills,
    allTaskIds,
  };
  return { ctx, error: null };
}

/**
 * H3A-032 三条 gate 需要"身份名 → LayeredRole"（areas/mergeAuthority/
 * dispatchAuthority）。今天只有 6 个持久角色文件（`.harness/agents/roles/`：
 * coord-architecture/coord-main/dev-ai-runtime/dev-chat-e2e/rev-e2e/
 * rev-feature）校验出 LayeredRole——8 个扁平 subagent spec（H3A-023）没有
 * areas/authority 字段，registry.yaml 的 worker 条目虽然有 `areas:`，但
 * RegistryIdentity 类型（role-authorization.ts）今天只解析 id/kind/active，
 * 不解析 areas——同 H3A-025 checkAuthorityMonotonicity 的既有口径一致（那条
 * 也只用 LayeredRole 集合，不吃扁平 spec），不在这个 PR 里顺带扩大
 * RegistryIdentity 的 schema。这意味着如果 assignee_role 指向一个**只登记
 * 在 registry.yaml、没有持久角色文件**的 worker（真实例子：`dev-platform-
 * baseline`/`dev-auth`——这两个只出现在 registry.yaml 的 agents[]，没有
 * `.harness/agents/roles/*.yaml` 文件），H3A-032a 会把它当"未知身份"报
 * FAIL——如实标注这个已知边界，不是 gate 的 bug。（`dev-ai-runtime`/
 * `dev-chat-e2e` 两个真实 worker 是有持久角色文件的，能被正常解析成
 * LayeredRole，不落入这个边界——PR 描述里的反证正是用它们触发 AREA/
 * AUTHORITY 分支，而不是 UNKNOWN-IDENTITY 分支。）
 */
function buildRolesByName(): ReadonlyMap<string, LayeredRole> {
  const { roles } = validateRoleFiles(readRoleFiles());
  return new Map(roles.map((r) => [r.name, r]));
}

/** 打印用的最小 finding 形状——H3A-031（`Finding`）和 H3A-032（`GateFinding`）字段结构相同，用一个通用签名避免额外的跨文件类型耦合。 */
interface PrintableFinding {
  code: string;
  severity: "FAIL" | "WARN";
  sourceFile: string;
  message: string;
}

function printGateFindings(label: string, findings: readonly PrintableFinding[]): void {
  if (findings.length === 0) {
    log.ok(`[task-assignment doctor] ${label}：干净`);
    return;
  }
  const fails = findings.filter((f) => f.severity === "FAIL");
  const warns = findings.filter((f) => f.severity === "WARN");
  if (fails.length > 0) {
    log.err(`[task-assignment doctor] ${label}：${fails.length} 条 FAIL`);
    for (const f of fails) log.err(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
  if (warns.length > 0) {
    log.warn(`[task-assignment doctor] ${label}：${warns.length} 条 WARN（不阻断）`);
    for (const f of warns) log.warn(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
}

export function taskAssignmentDoctor(_args: Args): void {
  const { instances, failures } = scanTaskAssignments();

  if (failures.length > 0) {
    log.err(`[task-assignment doctor] ${failures.length} 份 Task Assignment 实例 schema 校验失败：`);
    for (const f of failures) log.err(`   ✗ H3A030-SCHEMA-INVALID (${f.sourceFile}): ${f.message}`);
    process.exitCode = 1;
    return;
  }

  if (instances.length === 0) {
    log.ok(`[task-assignment doctor] .harness/tasks/：0 份实例——Epic E3 尚未产生真实 Task Assignment，是今天的已知状态，不是回归`);
  } else {
    log.ok(`[task-assignment doctor] .harness/tasks/：${instances.length} 份实例，全部通过 H3A-030 schema 校验`);
  }

  // H3A-031：Root→Domain 跨表 gate，只在 schema 全部通过时才有意义跑（上面已
  // 提前 return 处理 schema 失败的情况）。
  const allTaskIds = new Set(instances.map((i) => i.instance_id));
  const { ctx, error: ctxError } = buildRootDomainGateContext(allTaskIds);
  if (ctxError) {
    log.err(`[task-assignment doctor] H3A-031 UNKNOWN —— ${ctxError}，拒绝下判断`);
    process.exitCode = 1;
    return;
  }
  const rootDomainFindings = checkRootToDomainAssignments(instances, ctx!);
  printGateFindings("H3A-031 Root→Domain gate", rootDomainFindings);

  // H3A-032：Domain→Worker Task Assignment gate（三条，过滤范围不完全一致，
  // 见 lib/domain-worker-task-assignment-gate.ts 文件头的范围边界说明）：
  //   - 032a（不越领域）/032c（不越权限）只对 assigned_by 解析为
  //     layer:domain_orchestrator 的实例生效——Root 直派是 H3A-031 的范围，
  //     这两条不越界代它下判断。
  //   - 032b（不越配额）不按 assigned_by 过滤，是纯 budget 数值的结构自洽
  //     检查（全局生效，不管 assigned_by 是谁）。
  const rolesByName = buildRolesByName();

  const domainScopeFindings = checkDomainScope(instances, rolesByName);
  printGateFindings("H3A-032a 不越领域（assignee layer + areas 子集）", domainScopeFindings);

  const budgetFindings = checkWorkerBudgetQuota(instances);
  printGateFindings("H3A-032b 不越配额（budget 数值 vs §10.3 默认约定，全局生效不按 assigned_by 过滤）", budgetFindings);

  const authorityFindings = checkAssigneeAuthorityCeiling(instances, rolesByName);
  printGateFindings("H3A-032c 不越权限（assignee authority ≤ assigned_by）", authorityFindings);

  const gateFindings: PrintableFinding[] = [
    ...rootDomainFindings,
    ...domainScopeFindings,
    ...budgetFindings,
    ...authorityFindings,
  ];

  log.info("");
  log.info("以下部分本命令如实标注为「本条目范围外」，不是遗漏：");
  log.info("   · scope 越权只做字面 area 名启发式匹配（scope.include vs Domain areas[]），不解析路径模式——");
  log.info("     Proposal 原文没有给出「越权」的机器可判定定义，见 lib/task-assignment-root-domain-gate.ts 文件头");
  log.info("   · skill_refs 归属核实依赖全仓 Domain Skill 实例语料库，今天 0 个真实实例（H3A-012 已确认）——");
  log.info("     查无实例时判 WARN「无法核实」，不是判定「已核实无误」");
  log.info("   · dependencies 是否成环——本命令只查引用的 task_id 是否存在于语料库，不做环检测（H3A-031/032 均不覆盖）");
  log.info("   · assigned_by/assignee_role 按§10.2 原文应是 Directory ULID 运行时身份，本命令按已登记的稳定角色名/registry id 解析——" +
    "见 lib/domain-worker-task-assignment-gate.ts 文件头注释①，若传入真实 ULID 会被当成未知身份（FAIL），而不是静默放行");
  log.info("   · budget 是否有\"合理例外\"——schema 没有例外理由字段，本命令只能对超默认值的 max_parallel_workers 发 WARN，不能判定 FAIL/放行");
  log.info("   · authority_snapshot_hash 是否等于当前 Authorization Model 的真实哈希——运行态语义，本命令只检查非空字符串存在");

  const anyFail = gateFindings.some((f) => f.severity === "FAIL");
  process.exitCode = anyFail ? 1 : 0;
}
