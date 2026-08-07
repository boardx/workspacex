// role-authorization-doctor.ts — H3A-020/021/023/024/025/026/027/029 的仓库
// 侧入口（PROP-HARNESS-AGENT-001 Epic E2；H3A-022 需要 H3A-010 的 Domain
// Registry schema，H3A-028 是 P1，两条都不在这个命令里，留给之后的 PR）。
//
// pnpm harness role-authorization doctor
//
// 判定逻辑全在 lib/role-authorization.ts（纯函数，喂 fixture 单测）。这里
// 只做：读 6 个持久角色文件 + 8 个扁平 subagent spec + registry.yaml
// 的 agents[]/reviewers[] 两个数组 → 交给判定函数 → 打印结果、按 FAIL/WARN
// 决定退出码，同 terminology-doctor.ts / graph-authority-doctor.ts 的分层
// 方式一致。
//
// registry.yaml 的读取刻意复用 role-freeze-doctor.ts 已经踩过坑修好的
// "agents: + reviewers: 两个数组都要读"逻辑，不重新发明一遍。
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import {
  validateRoleFiles,
  checkRootOrchestratorSingleton,
  checkSpecialistWorkerSpecs,
  checkMaxDepthGate,
  checkAuthorityMonotonicity,
  checkMergeSignoffGate,
  checkProducerVerifierSeparation,
  checkRootDirectL3Exception,
  type RawRoleFile,
  type RawAgentSpec,
  type RegistryIdentity,
  type Finding,
  type LayeredRole,
} from "./lib/role-authorization";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const AGENTS_DIR = join(REPO_ROOT, ".harness", "agents");
const ROLES_DIR = join(AGENTS_DIR, "roles");
const REGISTRY_PATH = join(AGENTS_DIR, "registry.yaml");

function readRoleFiles(): RawRoleFile[] {
  if (!existsSync(ROLES_DIR)) return [];
  return readdirSync(ROLES_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((file) => ({
      sourceFile: `.harness/agents/roles/${file}`,
      parsed: parse(readFileSync(join(ROLES_DIR, file), "utf8")),
    }));
}

/** 扁平 subagent spec：`.harness/agents/*.yaml`，排除 roles/ 子目录和 registry.yaml 本身。 */
function readAgentSpecs(): RawAgentSpec[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".yaml") && f !== "registry.yaml")
    .filter((f) => statSync(join(AGENTS_DIR, f)).isFile())
    .sort()
    .map((file) => {
      const raw = parse(readFileSync(join(AGENTS_DIR, file), "utf8")) as
        | { name?: unknown; role?: unknown; tools?: unknown }
        | null;
      return {
        sourceFile: `.harness/agents/${file}`,
        name: raw?.name,
        role: raw?.role,
        tools: raw?.tools,
      };
    });
}

interface RegistryReadResult {
  agents: RegistryIdentity[];
  agentIds: Set<string>;
  reviewerIds: Set<string>;
  error: string | null;
}

/** 同 role-freeze-doctor.ts 的 IDENTITY_ARRAY_KEYS 教训：两个数组都要读，缺一个会把整组身份误判。 */
function readRegistry(): RegistryReadResult {
  const empty: RegistryReadResult = { agents: [], agentIds: new Set(), reviewerIds: new Set(), error: null };
  if (!existsSync(REGISTRY_PATH)) {
    return { ...empty, error: `registry.yaml 不存在：${REGISTRY_PATH}` };
  }
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (e) {
    return { ...empty, error: `registry.yaml 解析失败：${(e as Error).message}` };
  }
  const root = parsed as { agents?: unknown; reviewers?: unknown } | null;

  if (!Array.isArray(root?.agents)) {
    return { ...empty, error: "registry.yaml 的 agents 字段缺失或不是数组" };
  }
  if (root.reviewers !== undefined && !Array.isArray(root.reviewers)) {
    return { ...empty, error: "registry.yaml 的 reviewers 字段存在但不是数组" };
  }

  const agents: RegistryIdentity[] = (root.agents as unknown[])
    .map((a) => a as { id?: unknown; kind?: unknown; active?: unknown })
    .filter((a) => typeof a.id === "string" && typeof a.kind === "string")
    .map((a) => ({ id: a.id as string, kind: a.kind as string, active: a.active === true }));

  const agentIds = new Set(agents.map((a) => a.id));
  const reviewerIds = new Set(
    ((root.reviewers as unknown[] | undefined) ?? [])
      .map((r) => (r as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string"),
  );

  return { agents, agentIds, reviewerIds, error: null };
}

function printFindings(label: string, findings: readonly Finding[]): void {
  if (findings.length === 0) {
    log.ok(`[role-authorization doctor] ${label}：干净`);
    return;
  }
  const fails = findings.filter((f) => f.severity === "FAIL");
  const warns = findings.filter((f) => f.severity === "WARN");
  if (fails.length > 0) {
    log.err(`[role-authorization doctor] ${label}：${fails.length} 条 FAIL`);
    for (const f of fails) log.err(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
  if (warns.length > 0) {
    log.warn(`[role-authorization doctor] ${label}：${warns.length} 条 WARN（不阻断）`);
    for (const f of warns) log.warn(`   [${f.code}] ${f.sourceFile}: ${f.message}`);
  }
}

export function roleAuthorizationDoctor(_args: Args): void {
  const { error: registryError, agents, agentIds, reviewerIds } = readRegistry();
  if (registryError) {
    // registry.yaml 是身份权威，读不到时拒绝下判断（同 role-freeze-doctor.ts 的 fail-closed 先例）。
    log.err(`[role-authorization doctor] UNKNOWN —— ${registryError}，拒绝下判断`);
    process.exitCode = 1;
    return;
  }

  let roleFiles: RawRoleFile[];
  let agentSpecs: RawAgentSpec[];
  try {
    roleFiles = readRoleFiles();
    agentSpecs = readAgentSpecs();
  } catch (e) {
    log.err(`[role-authorization doctor] UNKNOWN —— 读取角色/subagent spec 文件失败：${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const allFindings: Finding[] = [];

  // H3A-020：schema + layer 派生。
  const { roles, findings: schemaFindings } = validateRoleFiles(roleFiles);
  allFindings.push(...schemaFindings);
  printFindings(`H3A-020 角色文件 schema（${roleFiles.length} 个文件）`, schemaFindings);

  const validRoles: readonly LayeredRole[] = roles;

  // H3A-021：Root Orchestrator 单例门。
  const rootFindings = checkRootOrchestratorSingleton(agents);
  allFindings.push(...rootFindings);
  printFindings("H3A-021 Root Orchestrator 单例门", rootFindings);

  // H3A-023：Specialist Worker（扁平 subagent spec）schema。
  const workerSpecFindings = checkSpecialistWorkerSpecs(agentSpecs);
  allFindings.push(...workerSpecFindings);
  printFindings(`H3A-023 Specialist Worker spec schema（${agentSpecs.length} 个文件）`, workerSpecFindings);

  // H3A-024：最大三层深度 gate。
  const depthFindings = checkMaxDepthGate(validRoles);
  allFindings.push(...depthFindings);
  printFindings("H3A-024 最大三层深度 gate", depthFindings);

  // H3A-025：authority monotonicity gate。
  const monotonicityFindings = checkAuthorityMonotonicity(validRoles);
  allFindings.push(...monotonicityFindings);
  printFindings("H3A-025 authority monotonicity gate", monotonicityFindings);

  // H3A-026：merge/signoff 权限 gate。
  const mergeSignoffFindings = checkMergeSignoffGate(validRoles);
  allFindings.push(...mergeSignoffFindings);
  printFindings("H3A-026 merge/signoff 权限 gate", mergeSignoffFindings);

  // H3A-027：producer/verifier separation（今天只能核实静态自我一致性）。
  const separationFindings = checkProducerVerifierSeparation(agentIds, reviewerIds, validRoles);
  allFindings.push(...separationFindings);
  printFindings("H3A-027 producer/verifier separation（静态自我一致性）", separationFindings);

  // H3A-029：Root 直派 L3 例外门。
  const directL3Findings = checkRootDirectL3Exception(validRoles);
  allFindings.push(...directL3Findings);
  printFindings("H3A-029 Root 直派 L3 例外门", directL3Findings);

  log.info("");
  log.info("以下条款本命令如实未实现（不是遗漏，是今天没有输入数据可判定）：");
  log.info("   · H3A-022（Domain Orchestrator Role 绑定 Domain/Skill）——依赖 H3A-010 Domain Registry schema，未落地");
  log.info("   · H3A-027 的完整 producer/verifier separation（同 actor 自产自签同一 artifact）——");
  log.info("     需要 Epic E3 的 Task Assignment/Review Decision 运行态数据，静态角色文件判不出");
  log.info("   · H3A-028（portable role generator 适配）——P1，本命令不覆盖");

  const anyFail = allFindings.some((f) => f.severity === "FAIL");
  process.exitCode = anyFail ? 1 : 0;
}
