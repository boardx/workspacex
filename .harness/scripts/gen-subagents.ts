// gen-subagents.ts — 从 .harness/agents/*.yaml 生成工具特定的 subagent 文件
// Claude Code: .claude/agents/<name>.md  (YAML frontmatter + system prompt)
// Codex:       .codex/agents/<name>.toml (TOML format)
// 原则：规格只写一次，两种格式从同一来源生成，行为不漂移。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { HARNESS_DIR, REPO_ROOT } from "./lib/paths";
import { log } from "./lib/log";
import type { Args } from "./lib/args";
import { KIND_TO_LAYER, checkSpecialistWorkerSpecs, type RawAgentSpec } from "./lib/role-authorization";

interface AgentSpec {
  name: string;
  description: string;
  role: string;
  context_isolation?: boolean;
  tools?: string[];
  allowed_commands?: string[];
  model?: { claude?: string; codex?: string };
  system_prompt?: string;
  rubric_ref?: string;
}

interface PersistentRoleSpec {
  name: string;
  description: string;
  role: "persistent-project-role";
  kind: string;
  areas: string[];
  reports_to: string | null;
  merge_authority: boolean;
  dispatch_authority: boolean;
  developer_instructions: string;
}

const PERSISTENT_ROLE_KEYS = [
  "areas",
  "description",
  "developer_instructions",
  "dispatch_authority",
  "kind",
  "merge_authority",
  "name",
  "reports_to",
  "role",
] as const;

const FORBIDDEN_RUNTIME_VALUE_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: "Directory ULID", pattern: /\bagt_[0-9A-HJKMNP-TV-Z]{26}\b/ },
  {
    label: "credential cache path",
    pattern: /(?:^|[\\/])(?:\.harness[\\/]state[\\/]\.cache[\\/])?coord-credentials\.json\b/i,
  },
  {
    label: "credential cache path",
    pattern: /(?:^|[\\/])[^\s"']*\.cache[\\/][^\s"']*credential[^\s"']*\.json\b/i,
  },
  { label: "private key material", pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/ },
  { label: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/i },
  {
    label: "token credential",
    pattern: /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/i,
  },
  {
    label: "assigned credential material",
    pattern:
      /(?:^|[\s,;])(?:secret|password|passphrase|token|credentials?|private[_ -]?key|api[_ -]?key)\s*[:=]\s*(?!\s*(?:none|null|redacted|\[redacted\])\b)\S+/i,
  },
  {
    label: "model selection",
    pattern: /(?:^|[\s,;])(?:model|model[_ -]?id|model[_ -]?provider)\s*[:=]\s*\S+/i,
  },
];

const AGENTS_DIR = join(HARNESS_DIR, "agents");
const ROLES_DIR = join(AGENTS_DIR, "roles");
const CLAUDE_AGENTS_DIR = join(REPO_ROOT, ".claude", "agents");
const CODEX_AGENTS_DIR = join(REPO_ROOT, ".codex", "agents");

/** 工具名称 → Claude Code tool 字符串映射 */
function toClaudeTools(tools: string[]): string[] {
  const map: Record<string, string> = {
    read_files: "Read",
    bash_restricted: "Bash",
    bash_git_readonly: "Bash",
    bash_search_readonly: "Bash",
    write_files: "Write",
  };
  return [...new Set(tools.map((t) => map[t] ?? t))];
}

/** 生成 Claude Code subagent .md */
function generateClaudeMd(spec: AgentSpec): string {
  const claudeTools = toClaudeTools(spec.tools ?? []);
  const model = spec.model?.claude ?? "claude-sonnet-4-6";

  const frontmatter = [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description.trim().replace(/\n/g, " ")}`,
    `model: ${model}`,
    claudeTools.length ? `tools:\n${claudeTools.map((t) => `  - ${t}`).join("\n")}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const body = spec.system_prompt?.trim() ?? `# ${spec.name}\n\n${spec.description}`;
  return `${frontmatter}\n\n${body}\n`;
}

/** 生成 Codex subagent .toml */
function generateCodexToml(spec: AgentSpec): string {
  const model = spec.model?.codex ?? "gpt-5.4-mini";
  const tools = spec.tools ?? [];
  const allowedCmds = spec.allowed_commands ?? [];

  const lines = [
    `# ${spec.name}.toml — 由 pnpm harness gen-subagents 自动生成`,
    `# 修改请改 .harness/agents/${spec.name}.yaml，然后重新运行 gen-subagents`,
    ``,
    `[agent]`,
    `name = "${spec.name}"`,
    `description = """`,
    spec.description.trim(),
    `"""`,
    `model = "${model}"`,
    `context_isolation = ${spec.context_isolation ?? false}`,
    ``,
    `[tools]`,
    `allowed = [${tools.map((t) => `"${t}"`).join(", ")}]`,
    ``,
  ];

  if (allowedCmds.length) {
    lines.push(`[shell]`);
    lines.push(`allowed_commands = [`);
    for (const cmd of allowedCmds) {
      lines.push(`  "${cmd}",`);
    }
    lines.push(`]`);
    lines.push(``);
  }

  if (spec.system_prompt) {
    lines.push(`[prompts]`);
    lines.push(`system = """`);
    lines.push(spec.system_prompt.trim());
    lines.push(`"""`);
  }

  return lines.join("\n") + "\n";
}

function normalizedSensitiveKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function forbiddenRuntimeKey(key: string): boolean {
  const normalized = normalizedSensitiveKey(key);
  const segments = normalized.split("_");
  if (segments.some((segment) => [
    "secret",
    "secrets",
    "password",
    "passwords",
    "passphrase",
    "token",
    "tokens",
    "credential",
    "credentials",
  ].includes(segment))) return true;
  return [
    "api_key",
    "private_key",
    "client_secret",
    "access_key",
    "credential_cache",
    "credentials_cache",
    "directory_agent_id",
    "claude_model",
    "codex_model",
  ].some((fragment) => normalized.includes(fragment));
}

function assertNoForbiddenRuntimeMaterial(
  file: string,
  value: unknown,
  path = "$",
  visited = new WeakSet<object>(),
): void {
  if (typeof value === "string") {
    for (const forbidden of FORBIDDEN_RUNTIME_VALUE_PATTERNS) {
      if (forbidden.pattern.test(value)) {
        throw new Error(`${file} 的 ${path} 含禁止的 ${forbidden.label}`);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenRuntimeMaterial(file, entry, `${path}[${index}]`, visited));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenRuntimeKey(key)) {
      throw new Error(`${file} 的 ${childPath} 是禁止的敏感字段`);
    }
    assertNoForbiddenRuntimeMaterial(file, entry, childPath, visited);
  }
}

function assertPersistentRoleSpec(file: string, value: unknown): asserts value is PersistentRoleSpec {
  if (!value || typeof value !== "object") throw new Error(`${file} 不是对象`);
  assertNoForbiddenRuntimeMaterial(file, value);
  const spec = value as Partial<PersistentRoleSpec> & Record<string, unknown>;
  const unknownKeys = Object.keys(spec).filter(
    (key) => !(PERSISTENT_ROLE_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`${file} 含未声明字段：${unknownKeys.sort().join(", ")}`);
  }
  if (
    typeof spec.name !== "string" || spec.name === "" ||
    typeof spec.description !== "string" || spec.description.trim() === "" ||
    spec.role !== "persistent-project-role" ||
    typeof spec.kind !== "string" || spec.kind === "" ||
    !Array.isArray(spec.areas) || !spec.areas.every((area) => typeof area === "string" && area !== "") ||
    !(spec.reports_to === null || typeof spec.reports_to === "string") ||
    typeof spec.merge_authority !== "boolean" ||
    typeof spec.dispatch_authority !== "boolean" ||
    typeof spec.developer_instructions !== "string" || spec.developer_instructions.trim() === ""
  ) {
    throw new Error(`${file} 不符合 persistent role schema`);
  }
  if (spec.developer_instructions.includes('"""')) {
    throw new Error(`${file} developer_instructions 不能包含 TOML 三引号`);
  }
  // H3A-020/H3A-028：kind 必须能派生出 layer——role-authorization-doctor.ts
  // 已经拿同一个 KIND_TO_LAYER 表对这 6 个文件判 FAIL/PASS；生成器如果不接
  // 同一张表，就可能为一个 doctor 判无效的 Role model 照常产出 Claude/Codex
  // 双格式文件（两条流水线各自校验、互不感知的漂移面）。这里拒绝生成，不
  // 悄悄放行、也不重新发明一张映射表。
  if (typeof spec.kind === "string" && spec.kind !== "" && !(spec.kind in KIND_TO_LAYER)) {
    throw new Error(
      `${file} 的 kind "${spec.kind}" 不在 H3A-020 layer 映射表 ` +
        `[${Object.keys(KIND_TO_LAYER).join(", ")}] 里，无法派生 layer，拒绝生成`,
    );
  }
}

/**
 * H3A-023/H3A-028：扁平 subagent spec 生成前的 Specialist Worker schema
 * 校验——复用 role-authorization.ts 的 `checkSpecialistWorkerSpecs`（同一份
 * 判定逻辑喂给 role-authorization doctor 和这里，不重新写一遍）。FAIL 严重
 * 度（缺 `role` 字段）阻断生成；WARN 严重度（`tools` 缺失/过多）只打印警告，
 * 同 doctor 的 severity 语义保持一致，不把 WARN 升级成阻断。
 */
export function assertSpecialistWorkerSpec(file: string, spec: RawAgentSpec): void {
  const findings = checkSpecialistWorkerSpecs([spec]);
  const fails = findings.filter((f) => f.severity === "FAIL");
  if (fails.length > 0) {
    throw new Error(
      `${file} 不符合 H3A-023 Specialist Worker schema：${fails.map((f) => f.message).join("；")}`,
    );
  }
  for (const w of findings.filter((f) => f.severity === "WARN")) {
    log.warn(`[gen-subagents] ${w.sourceFile}: ${w.message}`);
  }
}

function persistentRoleInstructions(spec: PersistentRoleSpec): string {
  const authority = [
    spec.merge_authority ? "你是唯一允许合并 PR 的稳定角色。" : "你不得合并 PR。",
    spec.dispatch_authority ? "你可以派发正式协调任务。" : "你不得派发正式协调任务。",
  ].join(" ");
  const reporting = spec.reports_to === null ? "无上级角色" : `向 ${spec.reports_to} 汇报`;
  return [
    `稳定角色：${spec.name}；kind：${spec.kind}；areas：${spec.areas.join(", ")}；${reporting}。`,
    authority,
    spec.developer_instructions.trim(),
  ].join("\n\n");
}

export function generatePersistentClaudeMd(spec: PersistentRoleSpec): string {
  assertPersistentRoleSpec("persistent role", spec);
  const frontmatter = [
    "---",
    `name: ${spec.name}`,
    `description: ${spec.description.trim().replace(/\n/g, " ")}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${persistentRoleInstructions(spec)}\n`;
}

export function generatePersistentCodexToml(spec: PersistentRoleSpec): string {
  assertPersistentRoleSpec("persistent role", spec);
  return [
    `name = "${spec.name}"`,
    `description = """`,
    spec.description.trim(),
    `"""`,
    `developer_instructions = """`,
    persistentRoleInstructions(spec),
    `"""`,
    ``,
  ].join("\n");
}

export function genSubagents(_args: Args): void {
  if (!existsSync(AGENTS_DIR)) {
    log.info(`找不到 ${AGENTS_DIR}，跳过（无 agent 规格文件）`);
    return;
  }

  mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
  mkdirSync(CODEX_AGENTS_DIR, { recursive: true });

  const yamlFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".yaml"));
  if (!yamlFiles.length) {
    log.info("没有找到 .yaml 规格文件");
    return;
  }

  let generated = 0;
  for (const file of yamlFiles) {
    const raw = readFileSync(join(AGENTS_DIR, file), "utf8");
    const spec = parse(raw) as AgentSpec;
    if (!spec.name) {
      log.warn(`${file} 缺少 name 字段，跳过`);
      continue;
    }
    assertSpecialistWorkerSpec(file, { sourceFile: file, name: spec.name, role: spec.role, tools: spec.tools });

    // 生成 Claude md
    const claudePath = join(CLAUDE_AGENTS_DIR, `${spec.name}.md`);
    writeFileSync(claudePath, generateClaudeMd(spec), "utf8");
    log.ok(`Claude:  ${claudePath}`);

    // 生成 Codex toml
    const codexPath = join(CODEX_AGENTS_DIR, `${spec.name}.toml`);
    writeFileSync(codexPath, generateCodexToml(spec), "utf8");
    log.ok(`Codex:   ${codexPath}`);

    generated++;
  }

  if (existsSync(ROLES_DIR)) {
    const roleFiles = readdirSync(ROLES_DIR).filter((file) => file.endsWith(".yaml")).sort();
    for (const file of roleFiles) {
      const raw = readFileSync(join(ROLES_DIR, file), "utf8");
      const parsed: unknown = parse(raw);
      assertPersistentRoleSpec(file, parsed);
      if (file !== `${parsed.name}.yaml`) {
        throw new Error(`${file} 的文件名必须与 name=${parsed.name} 一致`);
      }

      const claudePath = join(CLAUDE_AGENTS_DIR, `${parsed.name}.md`);
      writeFileSync(claudePath, generatePersistentClaudeMd(parsed), "utf8");
      log.ok(`Claude role: ${claudePath}`);

      const codexPath = join(CODEX_AGENTS_DIR, `${parsed.name}.toml`);
      writeFileSync(codexPath, generatePersistentCodexToml(parsed), "utf8");
      log.ok(`Codex role:  ${codexPath}`);
      generated++;
    }
  }

  log.info(`\n共生成 ${generated} 个 agent（每个 2 种格式）`);
  log.info(`  Claude: ${CLAUDE_AGENTS_DIR}`);
  log.info(`  Codex:  ${CODEX_AGENTS_DIR}`);
}
