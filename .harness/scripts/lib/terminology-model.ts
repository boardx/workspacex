/**
 * terminology-model.ts —— H3A-006/007 的 schema + 校验器。
 *
 * 同 E1 `template-model.ts` 的先例：plain TS interface + 手写校验函数，
 * 不用 zod（`.harness/scripts/lib/` 目录的既有惯例）。校验累积上报全部问题，
 * 不 fail-fast——同一条理由：一次 review 循环看到全部违规，比逐条发现逐条改
 * 省时间。
 */

export const TERM_ID_RE = /^TERM-([A-Z]{3})-(\d{3})$/;

export interface TerminologyEntry {
  term_id: string;
  category: string;
  legacy_names: string[];
  canonical_name_en: string;
  canonical_name_zh: string;
  usage_boundary: string;
}

export interface TerminologyRegistry {
  entries: TerminologyEntry[];
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

export function validateTerminologyEntry(raw: unknown, index: number): ValidationResult<TerminologyEntry> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `entries[${index}].${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `entries[${index}]`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.term_id) || !TERM_ID_RE.test(r.term_id)) {
    issues.push({ path: p("term_id"), message: `必须匹配 TERM-<域>-<编号>，实得 ${JSON.stringify(r.term_id)}` });
  }
  if (!isNonEmptyString(r.category)) {
    issues.push({ path: p("category"), message: "必须是非空字符串" });
  }
  if (!Array.isArray(r.legacy_names) || r.legacy_names.some((n) => typeof n !== "string")) {
    issues.push({ path: p("legacy_names"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  }
  if (!isNonEmptyString(r.canonical_name_en)) {
    issues.push({ path: p("canonical_name_en"), message: "必须是非空字符串" });
  }
  if (!isNonEmptyString(r.canonical_name_zh)) {
    issues.push({ path: p("canonical_name_zh"), message: "必须是非空字符串" });
  }
  if (!isNonEmptyString(r.usage_boundary)) {
    issues.push({ path: p("usage_boundary"), message: "必须是非空字符串" });
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      term_id: r.term_id as string,
      category: r.category as string,
      legacy_names: r.legacy_names as string[],
      canonical_name_en: r.canonical_name_en as string,
      canonical_name_zh: r.canonical_name_zh as string,
      usage_boundary: r.usage_boundary as string,
    },
    issues: [],
  };
}

/**
 * H3A-008 的核心判定之一：同一个旧名不得指向两个不同的规范术语——那正是
 * "歧义映射"，完成契约原文点名要红的东西。
 */
function findAmbiguousLegacyNames(entries: readonly TerminologyEntry[]): ValidationIssue[] {
  const owner = new Map<string, string>(); // legacy name -> term_id
  const issues: ValidationIssue[] = [];
  for (const entry of entries) {
    for (const name of entry.legacy_names) {
      const prior = owner.get(name);
      if (prior && prior !== entry.term_id) {
        issues.push({
          path: "entries[].legacy_names",
          message: `旧名 "${name}" 同时映射到 ${prior} 和 ${entry.term_id}：歧义映射`,
        });
      } else {
        owner.set(name, entry.term_id);
      }
    }
  }
  return issues;
}

export function validateTerminologyRegistry(raw: unknown): ValidationResult<TerminologyRegistry> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: "$", message: "顶层必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.entries)) {
    return { ok: false, value: null, issues: [{ path: "entries", message: "必须是数组" }] };
  }

  const issues: ValidationIssue[] = [];
  const entries: TerminologyEntry[] = [];
  r.entries.forEach((raw_entry, i) => {
    const result = validateTerminologyEntry(raw_entry, i);
    if (result.ok && result.value) entries.push(result.value);
    issues.push(...result.issues);
  });

  const seen = new Map<string, number>();
  entries.forEach((entry, i) => {
    const prior = seen.get(entry.term_id);
    if (prior !== undefined) {
      issues.push({
        path: `entries[${i}].term_id`,
        message: `与 entries[${prior}] 重复：${entry.term_id}`,
      });
    } else {
      seen.set(entry.term_id, i);
    }
  });

  issues.push(...findAmbiguousLegacyNames(entries));

  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { entries }, issues: [] };
}

/* ═══════════════════════ H3A-007：兼容映射 ═══════════════════════ */

export interface CompatMapping {
  old_field: string;
  new_field: string;
  strategy: string;
  stable_instance_id_unchanged: boolean;
}

export interface CompatRegistry {
  mappings: CompatMapping[];
}

export function validateCompatMapping(raw: unknown, index: number): ValidationResult<CompatMapping> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `mappings[${index}].${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `mappings[${index}]`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.old_field)) issues.push({ path: p("old_field"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.new_field)) issues.push({ path: p("new_field"), message: "必须是非空字符串" });
  if (!isNonEmptyString(r.strategy)) issues.push({ path: p("strategy"), message: "必须是非空字符串" });
  if (typeof r.stable_instance_id_unchanged !== "boolean") {
    issues.push({ path: p("stable_instance_id_unchanged"), message: "必须是布尔值" });
  }

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      old_field: r.old_field as string,
      new_field: r.new_field as string,
      strategy: r.strategy as string,
      stable_instance_id_unchanged: r.stable_instance_id_unchanged as boolean,
    },
    issues: [],
  };
}

export function validateCompatRegistry(raw: unknown): ValidationResult<CompatRegistry> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: "$", message: "顶层必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.mappings)) {
    return { ok: false, value: null, issues: [{ path: "mappings", message: "必须是数组" }] };
  }

  const issues: ValidationIssue[] = [];
  const mappings: CompatMapping[] = [];
  r.mappings.forEach((raw_mapping, i) => {
    const result = validateCompatMapping(raw_mapping, i);
    if (result.ok && result.value) mappings.push(result.value);
    issues.push(...result.issues);
  });

  // 同一个旧字段被映射到两个不同新字段——同 legacy_names 歧义判断同一条纪律。
  const owner = new Map<string, string>();
  mappings.forEach((m, i) => {
    const prior = owner.get(m.old_field);
    if (prior && prior !== m.new_field) {
      issues.push({
        path: `mappings[${i}].old_field`,
        message: `旧字段 "${m.old_field}" 同时映射到 "${prior}" 和 "${m.new_field}"：歧义映射`,
      });
    } else {
      owner.set(m.old_field, m.new_field);
    }
  });

  if (issues.length > 0) return { ok: false, value: null, issues };
  return { ok: true, value: { mappings }, issues: [] };
}
