/**
 * feature-schema.ts —— feature 字段的**单一事实源**（issue #386 / 审计 P1-5）。
 *
 * 在这之前，同一份 feature 结构被声明在**三处**，并且已经真的漂移了：
 *   · `.harness/templates/feature_list.template.json` —— 脚手架模板，缺 `spec_ref`/`depends_on`/`points`
 *   · `lib/types.ts` 的 `interface Feature` —— 全仓类型，缺 `points`（而 points 是 verify/估点对账在用的字段）
 *   · `validate-fl.ts` 自建的另一份 `interface Feature` —— 有 points，字段集又与上面两份都不同
 * 谁也不知道「一个 feature 到底有哪些字段、哪些必填」的答案该去哪一份里读。
 * 这正是根 AGENTS.md 点名的那种失效（「同一事实不得声明在两处」，本仓已五次栽在它上面）。
 *
 * 收敛方式：本文件登记字段表，另外三份**全部从它派生**——
 *   ① TS 类型：`lib/types.ts` 的 `Feature` 由 `FEATURE_FIELDS` 映射出来，不再手写字段；
 *   ② JSON 模板：`renderFeatureListTemplate()` 生成，`new-phase` 直接调它；
 *   ③ 校验器：`checkFeatureFields()` 遍历字段表判定，`validate-fl.ts` 调它，不再自建 interface。
 * 三者同源之后，「各自漂移」在结构上就不可能了；能漂移的只剩「模板文件被手改」这一条，
 * 由 `feature-schema-parity.test.ts` 的模板对账门控住。
 *
 * 风格上跟随 `lib/template-model.ts`：纯 TS + 手写校验，不为控制平面再引入 zod。
 */

/** 合法 feature 状态。声明在这里而不是 types.ts，是因为 `status` 字段的取值域属于字段表本身。 */
export type FeatureStatus = "not_started" | "in_progress" | "blocked" | "passing";
export const FEATURE_STATES: FeatureStatus[] = ["not_started", "in_progress", "blocked", "passing"];

/** 字段的值类别。`status` 单列一类，取值域就是 `FEATURE_STATES`。 */
export type FieldKind = "string" | "number" | "string[]" | "status";

export interface FieldSpec {
  readonly kind: FieldKind;
  /** 必填 = 每个 feature 都必须带这个 key。派生 TS 类型的可选性、校验器的缺失判定都读它。 */
  readonly required: boolean;
  /** 允许显式 null（`sprint`/`owner` 用 null 表示"未归属/未认领"，与"字段不存在"是两回事）。 */
  readonly nullable?: boolean;
  /** 字符串不得为空白、数组不得为空。 */
  readonly nonEmpty?: boolean;
  /** number 的下界（含）。 */
  readonly min?: number;
  /** 这个字段是什么。派生进 TS 类型的 doc 注释靠人读，这里是给校验信息和模板读者的。 */
  readonly doc: string;
  /** 脚手架模板里这个字段的取值。模板由它生成，不再有第二份手写模板。 */
  readonly sample: unknown;
}

/**
 * feature 字段表 —— 顺序即模板里的字段顺序。
 *
 * ⚠ 必填/可选按**仓库现状**登记，不是按愿望登记：`priority`/`area`/`sprint`/`notes`
 *   在 `lib/types.ts` 里一直写成必填，而全仓 458 个 feature 里分别有 51/6/48/16 个没有这个 key。
 *   类型说必填、数据说可选，这种"必填"只会让读类型的人做错判断（`featuresForSprint` 按
 *   `a.priority - b.priority` 排序，缺 priority 时实际是 NaN 比较）。所以这里按真相登记为可选，
 *   由调用方显式兜底。要把某个字段收紧成必填，是一次**带迁移的**改动：先补齐存量数据，再改这里。
 */
export const FEATURE_FIELDS = {
  id: {
    kind: "string",
    required: true,
    nonEmpty: true,
    doc: "阶段内唯一编号，形如 F01",
    sample: "F01",
  },
  priority: {
    kind: "number",
    required: false,
    doc: "排期优先级，数字越小越靠前（缺省时 featuresForSprint 按兜底值排）",
    sample: 1,
  },
  area: {
    kind: "string",
    required: false,
    doc: "所属领域，便于归类",
    sample: "orchestrator",
  },
  title: {
    kind: "string",
    required: true,
    nonEmpty: true,
    doc: "一句话标题",
    sample: "示例:健康检查端点",
  },
  user_visible_behavior: {
    kind: "string",
    required: true,
    nonEmpty: true,
    doc: "用户可见行为——完成定义第 1 条判的就是它",
    sample: 'GET /api/health 返回 200 且 body 为 {"ok": true}',
  },
  status: {
    kind: "status",
    required: true,
    doc: `状态，取值 ${FEATURE_STATES.join(" / ")}；passing 只能由 harness verify 写入`,
    sample: "not_started",
  },
  sprint: {
    kind: "string",
    required: false,
    nullable: true,
    doc: "所属 sprint（null = 尚未排入）",
    sample: null,
  },
  owner: {
    kind: "string",
    required: true,
    nullable: true,
    doc: "认领此 feature 的 agent 标识（null = 未认领；认领后不可被他人抢占）",
    sample: null,
  },
  capability: {
    kind: "string",
    required: false,
    doc: "所属能力平面（CAP-WEB / CAP-DATA / CAP-WORKFLOW…），便于按平面并行",
    sample: "CAP-WEB",
  },
  spec_ref: {
    kind: "string",
    required: true,
    doc: 'story 出处：`<requirements 文件名>#R<n>`，或已签核契约束锚点 `contracts/<束>#confirmed`',
    sample: "00-overview.md#R1",
  },
  depends_on: {
    kind: "string[]",
    required: false,
    doc: '前置依赖：同阶段写 "F0x"，跨阶段写 "p9:F0x"。用于 sweep-unblock / dep-graph',
    sample: [],
  },
  points: {
    kind: "number",
    required: true,
    min: 1,
    doc: "估点。与 UC 头部 `估点 **n**` 逐文件对账（validate-fl 的估点漂移检查）",
    sample: 3,
  },
  wave: {
    kind: "number",
    required: false,
    doc: "派发波次，纯提示性，不参与门控逻辑",
    sample: 1,
  },
  design_ref: {
    kind: "string",
    required: false,
    doc: "设计参照（prototype 锚点 / mockup 路径 / 已确认 UI 组件路径）；投影进 issue 供实现者定位",
    sample: "",
  },
  verification: {
    kind: "string[]",
    required: true,
    nonEmpty: true,
    doc: "可执行验证命令。每条都必须可能失败（见 lint-verification-can-fail.mjs）",
    sample: ["curl -sf http://localhost:3000/api/health | jq -e '.ok == true'"],
  },
  evidence: {
    kind: "string",
    required: true,
    doc: "证据（命令输出 / 日志 / commit / 截图路径）。⚠ 是 string，不是数组——写成数组会被按字符读",
    sample: "",
  },
  notes: {
    kind: "string",
    required: false,
    doc: "备注",
    sample: "把示例替换成你自己的功能。粒度=一次会话能完成。",
  },
} as const satisfies Record<string, FieldSpec>;

export type FeatureFields = typeof FEATURE_FIELDS;
export type FeatureFieldName = keyof FeatureFields;

export const FEATURE_FIELD_NAMES = Object.keys(FEATURE_FIELDS) as FeatureFieldName[];

export function fieldSpec(name: FeatureFieldName): FieldSpec {
  return FEATURE_FIELDS[name];
}

// ── ① 派生 TS 类型 ──────────────────────────────────────────────────────────
// 字段表是 `as const`，所以 `required`/`kind`/`nullable` 都是字面量类型，可以直接映射出
// 「哪些 key 必填、每个 key 是什么类型」。手写字段的那份 interface 由此彻底消失。

type ValueOfKind<K extends FieldKind> = K extends "string"
  ? string
  : K extends "number"
    ? number
    : K extends "string[]"
      ? string[]
      : FeatureStatus;

type ValueOf<S extends FieldSpec> =
  | ValueOfKind<S["kind"]>
  | (S extends { readonly nullable: true } ? null : never);

type RequiredFieldName = {
  [K in FeatureFieldName]: FeatureFields[K]["required"] extends true ? K : never;
}[FeatureFieldName];

type OptionalFieldName = Exclude<FeatureFieldName, RequiredFieldName>;

/** 把交叉类型摊平，让编辑器里 hover `Feature` 时看到的是一张字段表而不是 `A & B`。 */
type Flatten<T> = { [K in keyof T]: T[K] } & {};

/**
 * 一条 feature。字段集与可选性**全部**由 `FEATURE_FIELDS` 决定——
 * 想加字段/改必填，改字段表，类型、模板、校验器会一起跟着变。
 */
export type Feature = Flatten<
  { [K in RequiredFieldName]: ValueOf<FeatureFields[K]> } & {
    [K in OptionalFieldName]?: ValueOf<FeatureFields[K]>;
  }
>;

/**
 * 刚从磁盘读进来、还没过 `checkFeatureFields` 的 feature：字段可能缺、可能类型不对。
 * 语义判定（状态自洽、依赖闭合、估点对账）在结构判定之后跑，所以这里按
 * 「字段若存在则类型正确」来读；`id` 保留必填，因为所有报错信息都要点名是哪条。
 */
export type RawFeature = Partial<Feature> & { id: string };

/**
 * 排序用的 priority。
 *
 * `priority` 是可选字段（全仓 458 个 feature 里 51 个没有它）。类型此前谎称它必填，
 * 于是 archive-passing / dep-graph / features 三处都直接写 `a.priority - b.priority`——
 * 缺省时那是 `NaN` 比较，sort 的结果变成「取决于原始顺序」，错得毫无声响。
 * 缺省排在最后：没给优先级的活不该插队。
 */
export function featurePriority(f: { priority?: number }): number {
  return f.priority ?? Number.MAX_SAFE_INTEGER;
}

// ── ② 派生 JSON 模板 ────────────────────────────────────────────────────────

/** 模板里示例 feature 的取值，逐字来自字段表的 `sample`。 */
export function templateFeature(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of FEATURE_FIELD_NAMES) out[name] = FEATURE_FIELDS[name].sample;
  return out;
}

/**
 * 渲染 `feature_list.template.json` 的内容。
 *
 * `{{PHASE_ID}}` 是 `lib/render.ts` 的占位符约定，由 new-phase 替换；这里原样吐出，
 * 好让磁盘上那份模板既能被 new-phase 读、也能被人当字段说明书读（requirement-author
 * 的 SKILL.md 就指向它）。磁盘那份与本函数的输出由 parity 测试逐字对账。
 */
export function renderFeatureListTemplate(): string {
  return JSON.stringify({ phase: "{{PHASE_ID}}", features: [templateFeature()] }, null, 2) + "\n";
}

// ── ③ 派生校验器 ────────────────────────────────────────────────────────────

function kindMatches(kind: FieldKind, v: unknown): boolean {
  switch (kind) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "status":
      return typeof v === "string" && (FEATURE_STATES as string[]).includes(v);
  }
}

function kindLabel(kind: FieldKind): string {
  return kind === "status" ? `状态（${FEATURE_STATES.join(" / ")}）` : kind;
}

/**
 * 按字段表校验一条 feature 的**结构**（字段在不在、类型对不对、空不空）。
 *
 * 只管结构。跨字段的语义自洽（passing 必须有 sprint/evidence、not_started 不该有 owner、
 * 依赖是否存在、估点是否与 UC 头部对账……）仍在 validate-fl.ts 里——那些判定读的是
 * feature 之间和 feature 与文档之间的关系，不是某个字段自己的形状。
 *
 * 返回全部问题，不是遇到第一个就停（同 template-model.ts 的理由：只报第一条会让人改一轮撞一轮）。
 */
export function checkFeatureFields(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["不是一个对象"];
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];

  for (const name of FEATURE_FIELD_NAMES) {
    const spec: FieldSpec = FEATURE_FIELDS[name];
    const present = Object.prototype.hasOwnProperty.call(r, name);
    if (!present) {
      if (spec.required) problems.push(`缺必填字段 ${name}（${spec.doc}）`);
      continue;
    }
    const v = r[name];
    if (v === null) {
      if (!spec.nullable) problems.push(`${name} 不允许为 null（${kindLabel(spec.kind)}）`);
      continue;
    }
    if (!kindMatches(spec.kind, v)) {
      // 状态字段的「不合法」几乎总是写了个不在取值域里的字符串，报「类型应为…实为 string」
      // 读起来像在说类型写错了，会把人引到错的地方去改。
      problems.push(
        spec.kind === "status" && typeof v === "string"
          ? `${name} 取值 "${v}" 不合法，应为 ${FEATURE_STATES.join(" / ")} 之一`
          : `${name} 类型应为 ${kindLabel(spec.kind)}，实为 ${describe(v)}`,
      );
      continue;
    }
    if (spec.nonEmpty) {
      if (spec.kind === "string[]" && (v as string[]).length === 0) problems.push(`${name} 不得为空数组`);
      else if (typeof v === "string" && v.trim() === "") problems.push(`${name} 不得为空`);
    }
    if (spec.min !== undefined && typeof v === "number" && v < spec.min) {
      problems.push(`${name}=${v} 小于下界 ${spec.min}`);
    }
  }
  return problems;
}

function describe(v: unknown): string {
  if (Array.isArray(v)) return `array（${v.length} 项）`;
  return typeof v;
}

// ── 模板对账 ────────────────────────────────────────────────────────────────
// 三份声明收敛之后，唯一还能漂移的路径是：有人手改磁盘上那份模板文件
// （它是给人读的字段说明书，requirement-author 的 SKILL.md 就指向它）。
// 下面这个纯函数把「模板文件 == 字段表的生成物」变成可判定的，由 parity 测试消费。

export interface TemplateCheck {
  ok: boolean;
  problems: string[];
}

/**
 * 判定磁盘上的 `feature_list.template.json` 是否仍是本字段表的生成物。
 *
 * 逐字比对就够判绿判红了，但那样的报错信息只会说「两个大 JSON 不一样」。
 * 所以先逐字段报「少了谁 / 多了谁 / 顺序不对」，再兜一条逐字比对——
 * 少一条兜底，就会漏掉值被改坏（比如 `points: 3` 改成 `points: 0`）这类字段集看不出来的漂移。
 */
export function checkFeatureListTemplate(text: string | null): TemplateCheck {
  const problems: string[] = [];
  if (text === null) return { ok: false, problems: ["模板文件读不到"] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, problems: [`模板不是合法 JSON：${(e as Error).message}`] };
  }

  const root = parsed as { phase?: unknown; features?: unknown };
  if (root.phase !== "{{PHASE_ID}}") problems.push(`模板的 phase 应为占位符 {{PHASE_ID}}，实为 ${JSON.stringify(root.phase)}`);
  if (!Array.isArray(root.features) || root.features.length !== 1) {
    problems.push("模板应恰好带 1 条示例 feature");
  } else {
    const sample = root.features[0] as Record<string, unknown>;
    const actual = Object.keys(sample);
    for (const name of FEATURE_FIELD_NAMES) {
      if (!actual.includes(name)) problems.push(`模板缺字段 ${name}（字段表有，模板没有 ⇒ 脚手架产出的清单会缺这个字段）`);
    }
    for (const name of actual) {
      if (!(FEATURE_FIELD_NAMES as string[]).includes(name)) problems.push(`模板多出字段 ${name}（字段表里没有它）`);
    }
    if (problems.length === 0 && actual.join(",") !== FEATURE_FIELD_NAMES.join(",")) {
      problems.push(`模板字段顺序与字段表不一致：${actual.join(",")}`);
    }
  }

  if (text !== renderFeatureListTemplate()) {
    problems.push("模板与字段表的生成物不逐字相同 —— 模板是生成物，改字段表（lib/feature-schema.ts），不要手改模板文件");
  }
  return { ok: problems.length === 0, problems };
}
