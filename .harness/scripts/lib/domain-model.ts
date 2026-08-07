/**
 * domain-model.ts —— H3A-010：Domain Registry schema + 纯校验器。
 *
 * 背景（H3A-002/E0 inventory 的结论，见 docs/proposals/PROP-HARNESS-AGENT-001-
 * e0-inventory.md「Domains：四个信号源，互相不对齐」一节）：今天 Domain 边界
 * 同时活在四个互不一致的地方——`.harness/agents/registry.yaml` 的 `areas:`、
 * `.harness/state/module-lock-*.json`（gitignore，运行时才会出现的文件名）、
 * `.agents/skills/mod-<name>/`（0 个真实实例）、`project/PROJECT.md` 的占位符。
 * H3A-010 的任务不是消灭这四个信号源，是先建一个**第五处、但这次是唯一权威**
 * 的登记点：`.harness/domains/registry.yaml`，让后续 H3A-011+ 有地方把裁决结果
 * 落下来，而不是继续让四份文档各自代表"半个真相"。
 *
 * 同 template-model.ts / terminology-model.ts 的既有惯例：plain TS interface +
 * 手写校验函数，不引入 zod；校验累积上报全部问题，不 fail-fast——同一条理由，
 * 一次 review 循环看到全部违规比逐条发现省时间。
 *
 * `owner` 刻意允许为 `null`——H3A-011 的真实证据显示至少两个候选 Domain
 * （canvas-diagram、chat 与 e2e 的边界）今天没有唯一 owner（要么零 owner，
 * 要么两个 coordinator 同时声称同一个 area，见 inventory「Domains」一节和
 * 「e2e 被 rev-e2e 和 coord-chat-e2e 同时声称」）。把 owner 编成必填字符串
 * 会逼着 H3A-011 编造一个不存在的事实——这正是本条目的完成契约明确禁止的
 * "无目录猜测"。owner 为 null 是一种诚实状态，不是校验漏洞：本文件只保证
 * "字段类型正确"，不代表"边界已经没有歧义"，那是 doc 层面的人类确认工作
 * （PROP-HARNESS-AGENT-001-h3a011-domain-inventory.md）。
 */

export const DOMAIN_ID_RE = /^DOM-[A-Z0-9]+(-[A-Z0-9]+)*$/;

export type DomainStatus = "active" | "deprecated";
const DOMAIN_STATUSES: readonly DomainStatus[] = ["active", "deprecated"];

export interface DomainRegistryEntry {
  domain_id: string;
  name: string;
  /** null = 今天没有唯一权威 owner，真实证据存在歧义（见文件头注释）。 */
  owner: string | null;
  /** 与 registry.yaml areas[] / module-lock-<name>.json 文件名交叉核对的边界标签，至少 1 个。 */
  areas: string[];
  /** Contract Bundle 引用（如 phases/<phase>/contracts/<bundle>），可以为空数组。 */
  contracts: string[];
  /** 验证入口命令，可以为空数组。 */
  verification: string[];
  status: DomainStatus;
}

export interface DomainRegistry {
  entries: DomainRegistryEntry[];
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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateDomainEntry(raw: unknown, index: number): ValidationResult<DomainRegistryEntry> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `entries[${index}].${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `entries[${index}]`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.domain_id) || !DOMAIN_ID_RE.test(r.domain_id)) {
    issues.push({ path: p("domain_id"), message: `必须匹配 DOM-<大写字母/数字，可含连字符>，实得 ${JSON.stringify(r.domain_id)}` });
  }
  if (!isNonEmptyString(r.name)) {
    issues.push({ path: p("name"), message: "必须是非空字符串" });
  }
  if (r.owner !== null && !isNonEmptyString(r.owner)) {
    issues.push({ path: p("owner"), message: "必须是非空字符串或 null（null = 今天没有唯一权威 owner，需人类确认）" });
  }
  if (!isStringArray(r.areas) || r.areas.length === 0) {
    issues.push({ path: p("areas"), message: "必须是至少含 1 个元素的字符串数组" });
  }
  if (!isStringArray(r.contracts)) {
    issues.push({ path: p("contracts"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  }
  if (!isStringArray(r.verification)) {
    issues.push({ path: p("verification"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  }
  if (!isNonEmptyString(r.status) || !DOMAIN_STATUSES.includes(r.status as DomainStatus)) {
    issues.push({ path: p("status"), message: `必须是 ${DOMAIN_STATUSES.join("/")} 之一，实得 ${JSON.stringify(r.status)}` });
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      domain_id: r.domain_id as string,
      name: r.name as string,
      owner: r.owner as string | null,
      areas: r.areas as string[],
      contracts: r.contracts as string[],
      verification: r.verification as string[],
      status: r.status as DomainStatus,
    },
    issues: [],
  };
}

export function validateDomainRegistry(raw: unknown): ValidationResult<DomainRegistry> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: "$", message: "顶层必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.entries)) {
    return { ok: false, value: null, issues: [{ path: "entries", message: "必须是数组" }] };
  }

  const issues: ValidationIssue[] = [];
  const entries: DomainRegistryEntry[] = [];
  r.entries.forEach((raw_entry, i) => {
    const result = validateDomainEntry(raw_entry, i);
    if (result.ok && result.value) entries.push(result.value);
    issues.push(...result.issues);
  });

  const seen = new Map<string, number>();
  entries.forEach((entry, i) => {
    const prior = seen.get(entry.domain_id);
    if (prior !== undefined) {
      issues.push({ path: `entries[${i}].domain_id`, message: `与 entries[${prior}] 重复：${entry.domain_id}` });
    } else {
      seen.set(entry.domain_id, i);
    }
  });

  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { entries }, issues: [] };
}
