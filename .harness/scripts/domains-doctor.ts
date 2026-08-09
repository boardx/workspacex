// domains-doctor.ts — H3A-010/012/013/014/015/016/017（PROP-HARNESS-AGENT-001 Epic E1）的仓库侧入口。
//
// pnpm harness domains doctor
//
// 判定逻辑全在 lib/domain-model.ts、lib/domain-skill-model.ts、
// lib/domain-skill-gates.ts（纯函数，喂 fixture 单测）。这里只做 IO：
//   1. 读 .harness/domains/registry.yaml → 交给 validateDomainRegistry（H3A-010）
//   2. 扫 .agents/skills/mod-*/SKILL.md 的 frontmatter，挑出 template_id ===
//      "TPL-MOD-001" 的实例 → 交给 validateDomainSkillInstance（H3A-012），
//      顺手记下每份文件的行数（H3A-017 体积门要用）
//   3. 把 registry + 实例交给五条跨表 gate（H3A-013/014/015/016/017）
// 同 templates-doctor.ts/terminology-doctor.ts 的分层方式：本文件只管"从哪读、
// 输出成什么退出码"，不含判定逻辑本身。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { validateDomainRegistry, type DomainRegistryEntry } from "./lib/domain-model";
import { validateDomainSkillInstance, looksLikeDomainSkillInstance, type DomainSkillInstance } from "./lib/domain-skill-model";
import {
  findActiveGateViolations,
  findDeadReferences,
  findFreshnessIssues,
  findUnprovenActivePromotions,
  findEntrySizeIssues,
  type GateFinding,
} from "./lib/domain-skill-gates";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const REGISTRY_PATH = join(REPO_ROOT, ".harness", "domains", "registry.yaml");
const SKILLS_DIR = join(REPO_ROOT, ".agents", "skills");

/** 供 role-authorization-doctor.ts（H3A-022）复用——不重新发明一遍 registry.yaml 路径/读取。 */
export { REGISTRY_PATH as DOMAIN_REGISTRY_PATH };

export function readYaml(path: string): { parsed: unknown; error: string | null } {
  if (!existsSync(path)) return { parsed: null, error: `文件不存在：${path}` };
  try {
    return { parsed: parse(readFileSync(path, "utf8")), error: null };
  } catch (e) {
    return { parsed: null, error: `解析失败：${(e as Error).message}` };
  }
}

function extractFrontmatter(markdown: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  return m ? m[1]! : null;
}

/**
 * 扫描 `.agents/skills/mod-<name>/SKILL.md`（排除 `mod-_template`——文件头明确写
 * "模板，勿直接激活"，不是一个真实实例）。今天预期扫到 0 份合规实例
 * （H3A-002 inventory 现场核实过），这不是本函数的 bug，是仓库的真实状态。
 */
/** 供 role-authorization-doctor.ts（H3A-022）复用——不重新发明一遍 Domain Skill 实例扫描。 */
export function scanDomainSkillInstances(): {
  instances: DomainSkillInstance[];
  failures: { sourceFile: string; message: string }[];
  /** sourceFile（仓库相对路径）→ 该 SKILL.md 的行数，供 H3A-017 体积门使用。只收录扫描到的实例，不含 schema 校验失败的文件。 */
  lineCounts: Map<string, number>;
} {
  const instances: DomainSkillInstance[] = [];
  const failures: { sourceFile: string; message: string }[] = [];
  const lineCounts = new Map<string, number>();
  if (!existsSync(SKILLS_DIR)) return { instances, failures, lineCounts };

  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("mod-") && e.name !== "mod-_template")
    .map((e) => e.name)
    .sort();

  for (const dir of dirs) {
    const skillPath = join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const relPath = relative(REPO_ROOT, skillPath);
    const text = readFileSync(skillPath, "utf8");
    const yamlText = extractFrontmatter(text);
    if (yamlText === null) continue;

    let parsed: unknown;
    try {
      parsed = parse(yamlText);
    } catch {
      continue; // 不是合法 YAML frontmatter——同 template-scan.ts 的先例，静默跳过，不是我们的目标文件
    }
    if (!looksLikeDomainSkillInstance(parsed)) continue; // frontmatter 存在但不声明 TPL-MOD-001，不关我们的事（比如只有 name/description 的 skill 元信息）

    const result = validateDomainSkillInstance(parsed, relPath);
    if (result.ok && result.value) {
      instances.push(result.value);
      lineCounts.set(relPath, text.split("\n").length);
    } else {
      failures.push({ sourceFile: relPath, message: result.issues.map((i) => `${i.path}: ${i.message}`).join("；") });
    }
  }

  return { instances, failures, lineCounts };
}

function printFindings(findings: readonly GateFinding[]): void {
  for (const f of findings) {
    const marker = f.severity === "FAIL" ? "✗" : "!";
    const loc = f.sourceFile ? ` (${f.sourceFile})` : "";
    log.info(`   ${marker} ${f.code}${loc}: ${f.message}`);
  }
}

export function domainsDoctor(_args: Args): void {
  const { parsed: regRaw, error: regErr } = readYaml(REGISTRY_PATH);
  if (regErr) {
    log.err(`[domains doctor] UNKNOWN —— registry.yaml ${regErr}，拒绝下判断`);
    process.exitCode = 1;
    return;
  }

  const regResult = validateDomainRegistry(regRaw);
  if (!regResult.ok) {
    log.err(`[domains doctor] registry.yaml 校验失败，${regResult.issues.length} 条问题：`);
    for (const issue of regResult.issues) log.err(`   ${issue.path}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  const domains: DomainRegistryEntry[] = regResult.value!.entries;
  log.ok(`[domains doctor] registry.yaml：${domains.length} 个 Domain，无重复 domain_id`);

  const { instances: skills, failures, lineCounts } = scanDomainSkillInstances();
  let failed = false;

  if (failures.length > 0) {
    failed = true;
    log.err(`[domains doctor] ${failures.length} 份 Domain Skill 实例 schema 校验失败：`);
    for (const f of failures) log.err(`   ✗ H3A012-SCHEMA-INVALID (${f.sourceFile}): ${f.message}`);
  }

  const activeGateFindings = findActiveGateViolations(domains, skills);
  const deadRefFindings = findDeadReferences(skills, (p) => existsSync(join(REPO_ROOT, p)));
  const freshnessFindings = findFreshnessIssues(skills);
  const unprovenPromotionFindings = findUnprovenActivePromotions(skills);
  const entrySizeFindings = findEntrySizeIssues(skills, lineCounts);
  const allGateFindings = [
    ...activeGateFindings,
    ...deadRefFindings,
    ...freshnessFindings,
    ...unprovenPromotionFindings,
    ...entrySizeFindings,
  ];

  const failFindings = allGateFindings.filter((f) => f.severity === "FAIL");
  const warnFindings = allGateFindings.filter((f) => f.severity === "WARN");
  if (failFindings.length > 0) failed = true;

  log.info(`[domains doctor] ${skills.length} 份 Domain Skill 实例（H3A-012 schema 合规）`);
  if (allGateFindings.length > 0) {
    log.info(`[domains doctor] Domain↔Skill gate（H3A-013/014/015/016/017）：${failFindings.length} FAIL / ${warnFindings.length} WARN`);
    printFindings(allGateFindings);
  } else {
    log.ok(`[domains doctor] Domain↔Skill gate：无 finding`);
  }

  log.info("");
  log.info("以下部分本命令如实标注为「今天做不到 / 刻意不做」，不是遗漏（同 terminology-doctor.ts 的先例）：");
  log.info("   · H3A-014 只检查 authority_refs.{contracts,adrs,source_paths} 三个路径字段是否在仓库里存在，");
  log.info("     不检查 verification 字段（shell 命令，不是文件路径，不同性质的检查）");
  log.info("   · H3A-015 只检查 last_verified.commit 是否「像」一个 SHA（7~40 位十六进制），");
  log.info("     不通过 git 验证该 commit 是否真实存在于历史——那需要真实 git IO，本命令刻意只做形状检查");
  log.info("   · H3A-017 只检查 SKILL.md 入口文件行数是否超过 150 行阈值，不检查体积超标的实例是否配套");
  log.info("     reference 拆分目录——全仓今天没有任何既有的 reference 拆分约定可供比对，如实不做这一半");
  log.info("   · H3A-011（核心 Domain inventory）的边界裁决需要人类确认，本命令只校验 registry.yaml 的结构，");
  log.info("     不代表 registry.yaml 里的 owner/边界已经过人类签核——见 docs/proposals/PROP-HARNESS-AGENT-001-h3a011-domain-inventory.md");

  process.exitCode = failed ? 1 : 0;
}
