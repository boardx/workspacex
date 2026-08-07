/**
 * domain-skill-model.ts —— H3A-012：TPL-MOD-001 Domain Skill 实例 schema。
 *
 * 形状取自 Proposal §8.2 的示例（PROP-HARNESS-AGENT-001.md:433-448）：
 *
 *   template_id: TPL-MOD-001
 *   template_version: 1
 *   instance_id: MODKNOW-canvas-diagram
 *   skill_id: SKL-MOD-CANVAS-001
 *   domain_id: DOM-CANVAS-DIAGRAM
 *   status: active
 *   authority_refs: { contracts: [], adrs: [], source_paths: [], verification: [] }
 *   last_verified: { commit: <exact-sha>, evidence_refs: [] }
 *
 * 刻意不复用 template-model.ts 的通用 `InstanceMetadata`/`validateInstanceMetadata`：
 * 那套通用实例元数据要求 `scope: { project, phase }`，TPL-MOD-001 的真实形状没有
 * 这个字段（Domain Skill 不属于某个 phase，属于一个长期 Domain）。如果借用通用
 * scan，`.harness/templates/registry.yaml` 里目前也没有登记 TPL-MOD-001——本 PR
 * 刻意不把它塞进那份注册表：一旦塞进去，`templates-doctor` 的全仓扫描会用不匹配
 * 的通用 schema（要求 scope.project）去校验未来的真实 Domain Skill 实例，产生
 * 假阳性。这不是遗漏，是等 H3A-016+ 真的产出第一个实例时，由那条工作再决定
 * 是否要把两套 schema 合流，现在合并是空中楼阁。
 *
 * 校验风格同 domain-model.ts/terminology-model.ts：手写 + 累积上报。
 */

export const DOMAIN_SKILL_TEMPLATE_ID = "TPL-MOD-001" as const;

/** SKL-MOD-<大写域码>-<三位流水号>，同 template-model.ts TEMPLATE_ID_RE 的三位流水号惯例。 */
export const SKILL_ID_RE = /^SKL-MOD-[A-Z0-9-]+-\d{3}$/;

export type DomainSkillStatus = "active" | "superseded" | "retired";
const DOMAIN_SKILL_STATUSES: readonly DomainSkillStatus[] = ["active", "superseded", "retired"];

export interface AuthorityRefs {
  contracts: string[];
  adrs: string[];
  source_paths: string[];
  /** 验证命令（shell 命令字符串），不是文件路径——H3A-014 对它和其余三个字段的可核验方式不同。 */
  verification: string[];
}

export interface LastVerified {
  /** 精确 commit SHA；null = 从未验证过（H3A-015 判定为 WARN，不是 FAIL——见 domain-skill-gates.ts）。 */
  commit: string | null;
  evidence_refs: string[];
}

export interface DomainSkillInstance {
  template_id: typeof DOMAIN_SKILL_TEMPLATE_ID;
  template_version: number;
  instance_id: string;
  skill_id: string;
  domain_id: string;
  status: DomainSkillStatus;
  authority_refs: AuthorityRefs;
  last_verified: LastVerified;
  /** 扫描时附加的定位信息，不是文档自身字段。 */
  sourceFile: string;
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

function validateAuthorityRefs(raw: unknown, sourceFile: string): ValidationResult<AuthorityRefs> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#authority_refs.${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#authority_refs`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  for (const field of ["contracts", "adrs", "source_paths", "verification"] as const) {
    if (!isStringArray(r[field])) {
      issues.push({ path: p(field), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
    }
  }
  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      contracts: r.contracts as string[],
      adrs: r.adrs as string[],
      source_paths: r.source_paths as string[],
      verification: r.verification as string[],
    },
    issues: [],
  };
}

function validateLastVerified(raw: unknown, sourceFile: string): ValidationResult<LastVerified> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#last_verified.${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: `${sourceFile}#last_verified`, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;
  if (r.commit !== null && !isNonEmptyString(r.commit)) {
    issues.push({ path: p("commit"), message: "必须是非空字符串或 null（null = 从未验证过）" });
  }
  if (!isStringArray(r.evidence_refs)) {
    issues.push({ path: p("evidence_refs"), message: "必须是字符串数组（可以为空数组，但字段本身必须存在）" });
  }
  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      commit: (r.commit as string | null) ?? null,
      evidence_refs: r.evidence_refs as string[],
    },
    issues: [],
  };
}

/**
 * 校验一份已解析的 YAML（通常来自 `.agents/skills/mod-<domain>/SKILL.md` 的
 * frontmatter）是否是合法的 TPL-MOD-001 Domain Skill 实例。
 *
 * 调用方（domains-doctor.ts）负责先判断"这份 YAML 看起来像不像 Domain Skill
 * 实例"（`template_id === "TPL-MOD-001"`）——本函数假设调用方已经做了这层筛选，
 * 只负责结构完整性，不负责"要不要理会这份文件"。
 */
export function validateDomainSkillInstance(raw: unknown, sourceFile: string): ValidationResult<DomainSkillInstance> {
  const issues: ValidationIssue[] = [];
  const p = (field: string) => `${sourceFile}#${field}`;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, issues: [{ path: sourceFile, message: "必须是对象" }] };
  }
  const r = raw as Record<string, unknown>;

  if (r.template_id !== DOMAIN_SKILL_TEMPLATE_ID) {
    issues.push({ path: p("template_id"), message: `必须等于 "${DOMAIN_SKILL_TEMPLATE_ID}"，实得 ${JSON.stringify(r.template_id)}` });
  }
  if (typeof r.template_version !== "number" || !Number.isInteger(r.template_version) || r.template_version < 1) {
    issues.push({ path: p("template_version"), message: `必须是 ≥1 的整数，实得 ${JSON.stringify(r.template_version)}` });
  }
  if (!isNonEmptyString(r.instance_id)) {
    issues.push({ path: p("instance_id"), message: "必须是非空字符串" });
  }
  if (!isNonEmptyString(r.skill_id) || !SKILL_ID_RE.test(r.skill_id)) {
    issues.push({ path: p("skill_id"), message: `必须匹配 SKL-MOD-<域码>-<三位编号>，实得 ${JSON.stringify(r.skill_id)}` });
  }
  // domain_id 的格式（DOM-*）由 domain-model.ts 的 DOMAIN_ID_RE 定义；这里只查非空字符串，
  // 避免两个文件互相 import 出一个不必要的耦合方向——是否在 registry.yaml 里真实存在，
  // 是 H3A-013 的跨表检查（domain-skill-gates.ts），不是本文件的单表结构校验。
  if (!isNonEmptyString(r.domain_id)) {
    issues.push({ path: p("domain_id"), message: "必须是非空字符串" });
  }
  if (!isNonEmptyString(r.status) || !DOMAIN_SKILL_STATUSES.includes(r.status as DomainSkillStatus)) {
    issues.push({ path: p("status"), message: `必须是 ${DOMAIN_SKILL_STATUSES.join("/")} 之一，实得 ${JSON.stringify(r.status)}` });
  }

  const authorityResult = validateAuthorityRefs(r.authority_refs, sourceFile);
  issues.push(...authorityResult.issues);
  const lastVerifiedResult = validateLastVerified(r.last_verified, sourceFile);
  issues.push(...lastVerifiedResult.issues);

  if (issues.length > 0) return { ok: false, value: null, issues };
  return {
    ok: true,
    value: {
      template_id: DOMAIN_SKILL_TEMPLATE_ID,
      template_version: r.template_version as number,
      instance_id: r.instance_id as string,
      skill_id: r.skill_id as string,
      domain_id: r.domain_id as string,
      status: r.status as DomainSkillStatus,
      authority_refs: authorityResult.value!,
      last_verified: lastVerifiedResult.value!,
      sourceFile,
    },
    issues: [],
  };
}

/** 判断一份已解析的 YAML 是否"看起来像" TPL-MOD-001 实例——同 template-scan.ts looksLikeInstance 的筛选思路。 */
export function looksLikeDomainSkillInstance(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return (parsed as Record<string, unknown>).template_id === DOMAIN_SKILL_TEMPLATE_ID;
}
