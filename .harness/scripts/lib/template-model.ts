/**
 * template-model.ts —— PROP-HARNESS-MODEL-001 Epic E1（HMV2-006~008）。
 *
 * 两层 schema：
 *   1. **Registry entry**（HMV2-007）—— `TPL-<域>-<流水号>` 本身的元数据：
 *      名字、版本、生命周期状态、owner、消费者。这是"模板类型"的登记。
 *   2. **Instance metadata**（HMV2-008）—— 每份具体产物（一条 Feature、一次
 *      Review Verdict……）头部必须携带的公共字段。这是"这份文档属于哪个模板、
 *      是第几版"的登记。
 *
 * 两者刻意分开：注册表回答"这类模板存在吗、还活着吗"，实例元数据回答"这份
 * 具体文档是不是这类模板的一个合法成员"。E1 只做这两层通用外壳 + 跨切面门控
 * （唯一性/生命周期/引用完整性），**不**为 23 种模板各自建深度 schema——那是
 * E3/E4/E5 各自 Epic 的事，此刻做了也是空中楼阁，没有实例可验。
 *
 * 不用 zod：`.harness/scripts/lib/` 下其余文件（rewrite-coverage.ts、
 * stack-admission.ts、test-isolation.ts）都是纯 TS + 手写校验，跟随既有风格，
 * 不为控制平面工具链多引入一个依赖。
 */

/** `TPL-<三位领域码>-<三位流水号>`，域码大写字母，流水号三位零填充。 */
export const TEMPLATE_ID_RE = /^TPL-([A-Z]{3})-(\d{3})$/;

export type TemplateStatus = "active" | "deprecated" | "retired";
const TEMPLATE_STATUSES: readonly TemplateStatus[] = ["active", "deprecated", "retired"];

export interface TemplateRegistryEntry {
  template_id: string;
  template_version: number;
  name: string;
  status: TemplateStatus;
  owner: string;
  /** 谁在读这个模板产出的实例——空数组会被 doctor 标为可疑（见 #12 引用完整性精神的延伸） */
  consumers: string[];
  /** 对应 Proposal §8 表格"权威性质"列（人工维护 / 系统创建 / agent 创建……），自由文本 */
  authority: string;
}

export interface TemplateRegistry {
  entries: TemplateRegistryEntry[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  value: T | null;
  issues: ValidationIssue[];
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

/**
 * 校验单条 registry entry。返回值里的 issues 累加**全部**问题，不是遇到第一个就停——
 * 今天全天的教训之一：只报第一个缺陷，会让人改一条又撞下一条，白跑好几轮。
 */
export function validateRegistryEntry(raw: unknown, index: number): ValidationResult<TemplateRegistryEntry> {
  const p = (field: string) => `entries[${index}].${field}`;
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, value: null, issues: [issue(`entries[${index}]`, "不是一个对象")] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r["template_id"] !== "string" || !TEMPLATE_ID_RE.test(r["template_id"])) {
    issues.push(issue(p("template_id"), `必须匹配 TPL-<三位大写字母>-<三位数字>，实得 ${JSON.stringify(r["template_id"])}`));
  }
  if (typeof r["template_version"] !== "number" || !Number.isInteger(r["template_version"]) || r["template_version"] < 1) {
    issues.push(issue(p("template_version"), `必须是 ≥1 的整数，实得 ${JSON.stringify(r["template_version"])}`));
  }
  if (typeof r["name"] !== "string" || r["name"].trim().length === 0) {
    issues.push(issue(p("name"), "必须是非空字符串"));
  }
  if (typeof r["status"] !== "string" || !TEMPLATE_STATUSES.includes(r["status"] as TemplateStatus)) {
    issues.push(issue(p("status"), `必须是 ${TEMPLATE_STATUSES.join("/")} 之一，实得 ${JSON.stringify(r["status"])}`));
  }
  if (typeof r["owner"] !== "string" || r["owner"].trim().length === 0) {
    issues.push(issue(p("owner"), "必须是非空字符串"));
  }
  if (!Array.isArray(r["consumers"]) || !r["consumers"].every((c) => typeof c === "string")) {
    issues.push(issue(p("consumers"), "必须是字符串数组（可以为空数组，但字段必须存在）"));
  }
  if (typeof r["authority"] !== "string" || r["authority"].trim().length === 0) {
    issues.push(issue(p("authority"), "必须是非空字符串"));
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      template_id: r["template_id"] as string,
      template_version: r["template_version"] as number,
      name: r["name"] as string,
      status: r["status"] as TemplateStatus,
      owner: r["owner"] as string,
      consumers: r["consumers"] as string[],
      authority: r["authority"] as string,
    },
    issues: [],
  };
}

/** 校验整份注册表：逐条校验 entry，再做表级检查（重复 template_id）。 */
export function validateRegistry(raw: unknown): ValidationResult<TemplateRegistry> {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Record<string, unknown>)["entries"])) {
    return { ok: false, value: null, issues: [issue("$", "注册表必须是 { entries: [...] } 形状")] };
  }
  const rawEntries = (raw as Record<string, unknown>)["entries"] as unknown[];
  const entries: TemplateRegistryEntry[] = [];
  for (let i = 0; i < rawEntries.length; i += 1) {
    const result = validateRegistryEntry(rawEntries[i], i);
    issues.push(...result.issues);
    if (result.value) entries.push(result.value);
  }

  // 表级：重复 template_id。这条本身就是 HMV2-010（唯一性门控）对"模板类型"这一层的应用
  // ——实例层的唯一性是另一个函数（instanceIdDuplicates），故意不合并成一个函数：
  // 两者的数据来源、扫描范围、报错语义都不同，合并只会让两条不变量互相遮挡。
  const seen = new Map<string, number>();
  entries.forEach((e, i) => {
    const first = seen.get(e.template_id);
    if (first !== undefined) {
      issues.push(issue(`entries[${i}].template_id`, `与 entries[${first}] 重复：${e.template_id}`));
    } else {
      seen.set(e.template_id, i);
    }
  });

  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { entries }, issues: [] };
}

export type InstanceStatus = "active" | "superseded" | "retired";
const INSTANCE_STATUSES: readonly InstanceStatus[] = ["active", "superseded", "retired"];

export interface InstanceMetadata {
  template_id: string;
  template_version: number;
  instance_id: string;
  status: InstanceStatus;
  scope: { project: string; phase: string | null };
  refs: string[];
  /** 文件路径，扫描时附加，不是文档自身声明的字段——用于报错定位。 */
  sourceFile: string;
}

/** 校验单份实例的公共元数据块（HMV2-008）。 */
export function validateInstanceMetadata(raw: unknown, sourceFile: string): ValidationResult<InstanceMetadata> {
  const issues: ValidationIssue[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, value: null, issues: [issue(sourceFile, "不是一个对象")] };
  }
  const r = raw as Record<string, unknown>;
  const p = (field: string) => `${sourceFile}#${field}`;

  if (typeof r["template_id"] !== "string" || !TEMPLATE_ID_RE.test(r["template_id"])) {
    issues.push(issue(p("template_id"), `必须匹配 TPL-<域>-<编号>，实得 ${JSON.stringify(r["template_id"])}`));
  }
  if (typeof r["template_version"] !== "number" || !Number.isInteger(r["template_version"]) || r["template_version"] < 1) {
    issues.push(issue(p("template_version"), "必须是 ≥1 的整数"));
  }
  if (typeof r["instance_id"] !== "string" || r["instance_id"].trim().length === 0) {
    issues.push(issue(p("instance_id"), "必须是非空字符串"));
  }
  if (typeof r["status"] !== "string" || !INSTANCE_STATUSES.includes(r["status"] as InstanceStatus)) {
    issues.push(issue(p("status"), `必须是 ${INSTANCE_STATUSES.join("/")} 之一`));
  }
  const scope = r["scope"];
  if (typeof scope !== "object" || scope === null || typeof (scope as Record<string, unknown>)["project"] !== "string") {
    issues.push(issue(p("scope.project"), "scope.project 必须是字符串"));
  }
  const phase = (scope as Record<string, unknown> | undefined)?.["phase"];
  if (phase !== null && phase !== undefined && typeof phase !== "string") {
    issues.push(issue(p("scope.phase"), "scope.phase 必须是字符串或 null"));
  }
  if (r["refs"] !== undefined && (!Array.isArray(r["refs"]) || !r["refs"].every((x) => typeof x === "string"))) {
    issues.push(issue(p("refs"), "refs 如果存在必须是字符串数组"));
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      template_id: r["template_id"] as string,
      template_version: r["template_version"] as number,
      instance_id: r["instance_id"] as string,
      status: r["status"] as InstanceStatus,
      scope: {
        project: (scope as Record<string, unknown>)["project"] as string,
        phase: (phase as string | null | undefined) ?? null,
      },
      refs: (r["refs"] as string[] | undefined) ?? [],
      sourceFile,
    },
    issues: [],
  };
}
