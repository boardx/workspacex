/**
 * 设计配置项定义表 —— **本束的分母与必填的唯一事实源**（F17 / I-5 / I-6 / I-20）。
 *
 * ## 这张表为什么必须是唯一的一份
 *
 * `uc-2-1` R3 的裁决（O-07）逐字要求：「实现必须由**配置项定义表**驱动，
 * 分母 ＝ 表中已定义项数，**禁止硬编码 16 或 15**；该表同时含 `required` 布尔列（O-18 ⑤）」。
 *
 * 原型面板标题写 `16 / 16`，实际只枚举出 15 项。**第 16 项是「待补抽取」而不是「待裁决」**——
 * 它不阻断本 feature，因为槽位、分母、必填判定**全部从这张表运行时派生**：
 * 补出第 16 项 = 在下面的数组里加一行，代码与测试一行都不用改。
 * 反过来，任何地方把 15 / 16 或槽位清单再写一遍，就把「表变了」和「行为变了」拆成了两件事，
 * 而本仓已**九次**因「同一事实声明在两处」漂移。故本文件配了机械门控：
 * `apps/api/scripts/lint-design-facet-single-source.mjs`。
 *
 * ## 这里刻意**没有**的东西
 *
 * · **没有常量 `15` / `16`** —— 分母是 `DESIGN_FACET_DEFINITIONS.length`，不是字面量。
 * · **没有 `required = true` 的项** —— 哪些必填是**数据缺口 D-2**（O-18 ⑤ 明写
 *   「清单本身无依据，仍需人类给出」）。今天全 false 是**与原型一致的现状**：
 *   原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布**（D-9 / `KNOWN_CONTRACT_GAPS.T3`）。
 *   ⚠ 这不是「门没实现」：`publish-gate.ts` 的判定语句恒为
 *   「存在 `required = true` 且未完成的项 ⇒ 阻断」，**与具体是哪几项无关**（I-6），
 *   且 `required-column-drives-gate.test.ts` 用改过 `required` 列的表证明它真的会拦。
 * · **没有 zod** —— `apps/api` 不许自建 schema（`contract-single-source.test.ts` 第三条）。
 *   形状归契约：本文件的行**必须**能被 `templates.DesignFacetDefinition` 解析。
 *
 * ## 与契约的一处已知偏差（不选边，登记备查）
 *
 * `packages/contracts/src/templates.ts` 的 `DesignFacetDefinition` 只有
 * `designFacetKey / label / required / ordinal` **四个字段，没有 `group`**，
 * 而 `domain.md` 的 `ConfigItemDefinition` 与 UC-2.1 V1（「分组为五组」）都要求分组。
 * ⇒ `group` 今天只能住在领域层，`listDesignFacetDefinitions` 的响应体**表达不了五组**。
 * 见 `DESIGN_FACET_CONTRACT_GAP`。**agent 不改 `packages/contracts/**`**，这条交人类裁。
 */

import type { z } from "zod";
import { templates } from "@repo/contracts";

/**
 * 五组，**封闭枚举**（I-20，`domain.md` §一 `ConfigItemDefinition.group`）。
 *
 * ⚠ 要守的性质是**封闭性**，不是成员数——断言写成 `toHaveLength(5)` 会让一次经 ADR
 * 评审的正当新增被自己的测试拦下（`contract-design.md` §五 第 7 条）。
 * 断言写成「集合与本常量相等，且未声明的值被拒」。
 */
export const DESIGN_FACET_GROUPS = ["basic", "pre-input", "onsite", "ai", "output"] as const;

export type DesignFacetGroup = (typeof DESIGN_FACET_GROUPS)[number];

/**
 * 五组的**目录标题**（`uc-2-1` R8 侧栏分组标题：基本配置 / 会前输入 / 现场 / AI 能力 / 产出）。
 *
 * ⚠ 它住在这里而不是界面里，理由与分母同源（I-5）：一旦分组标题在前端另写一份，
 * 「表里有这一组」与「界面上有这一组」就成了两件可以各自为真的事。
 * ⚠ R8 明写侧栏标题**不进「原样呈现」清单**（原型原文是「设计环节」，D-03 已正名为
 * 「设计配置」），所以这几个词是**本文的产物**，可随裁决改——正因如此更要只有一份。
 * 类型是 `Record<DesignFacetGroup, string>`：新增一组而忘了给标题 ⇒ **编译期**就红。
 */
export const DESIGN_FACET_GROUP_LABEL: Record<DesignFacetGroup, string> = {
  basic: "基本配置",
  "pre-input": "会前输入",
  onsite: "现场",
  ai: "AI 能力",
  output: "产出",
};

/** 契约侧的一行（四字段）。派生，不重写——`lint-contract-source` 强制。 */
type ContractDesignFacet = z.infer<typeof templates.DesignFacetDefinition>;

/**
 * 领域侧的一行 = 契约四字段 **+ `group`** **+ `initCategory`**。
 *
 * ⚠ 不叫 `DesignFacetDefinition`：那个名字属于契约，后端重名一次就是第二份定义
 * （`contract-single-source.test.ts` 第二条会红）。
 *
 * `initCategory`（F21 / `uc-2-1` R6 AC5，I-17）是「这一项设计配置落进
 * 『套用后会初始化什么』六类一览的哪一类」——**同一行**，不是另开一张
 * 「facet key → category」的对照表：那张表本身就是 I-5 在防的第二份副本
 * （`lint-design-facet-single-source.mjs` 规则 2b 会把它当成第二张定义表报出来）。
 * 挂在这一行上，`initCategory` 就跟 `required` / `group` 一样，改表即改判断。
 * ⚠ **可选**（`| null` 且字段本身 optional）：既是因为
 * `topic-and-background` 刻意不进任何一类（定题是继承的种子，见
 * `initialization-preview.ts` 文件头），也是为了不逼着已有的测试夹具
 * （`designer-shell-version-bar.test.ts` 等处手写的 `DesignFacetRow` 字面量）
 * 都补一个跟它们无关的字段。
 */
export interface DesignFacetRow extends ContractDesignFacet {
  /** 五组之一（I-20）。⚠ 契约今天带不动这个字段，见 `DESIGN_FACET_CONTRACT_GAP` */
  readonly group: DesignFacetGroup;
  /** 六类之一；null ⇒ 刻意不进一览（今天只有 `topic-and-background`）。见上方长注 */
  readonly initCategory?: z.infer<typeof templates.InitializationCategory> | null;
}

/**
 * **表本体。改这里，槽位 / 分母 / 必填判定全部自动跟着变。**
 *
 * `ordinal` 是**组内序**（`domain.md` 逐字「组内序」）。UC-2.1 R3 表里的 1…15 是
 * 全局序号，由 `orderedDesignFacets()` 从「组顺序 × 组内序」派生——**不在表里存第二遍**。
 *
 * 15 项来自 `uc-2-1` R3 表（V1b 逐项断言）：
 * 基本配置 4 · 会前输入 3 · 现场 4 · AI 能力 2 · 产出 2。
 *
 * ⚠ **key 刻意与 `apps/web/lib/mock/tpl.ts` 的 `CONFIG_ITEMS` 逐字对齐**，
 * 这样两张表之间**只剩两处真分歧**，而它们恰好就是两个公开的未决问题：
 *   ① mock 多一行 `basic-overview`（16 行 vs 15 行）——2026-07-30 的保真度重做声称
 *      找到了第 16 项「基本配置是面板不是分组标题」，而 `domain.md` / `uc-2-1` R3
 *      仍记「15 项 + 第 16 项待补抽取（O-07）」。
 *   ② mock 有 5 项 `required: true`，本表 0 项——mock 自己标注那是「占位示例」，
 *      真正清单缺 D-2（O-18 ⑤「清单本身无依据，仍需人类给出」）。
 * **两条都不选边**：哪张表对是签核问题，不是代码问题。
 * 现状由 `lint-design-facet-single-source.mjs` 报成 DEBT 并把规模钉死，不许悄悄长大。
 */
export const DESIGN_FACET_DEFINITIONS: readonly DesignFacetRow[] = [
  // 定题是分组/议程/AI 上下文共同继承的种子（uc-2-2「定题单点继承」），不是六类之一——
  // initCategory 刻意留 null，见上方 DesignFacetRow 长注与 initialization-preview.ts 文件头。
  { designFacetKey: "topic-and-background", label: "主题与背景", group: "basic", ordinal: 1, required: false, initCategory: null },
  { designFacetKey: "flow-agenda", label: "流程 Agenda", group: "basic", ordinal: 2, required: false, initCategory: "议程环节" },
  { designFacetKey: "grouping-rule", label: "分组规则", group: "basic", ordinal: 3, required: false, initCategory: "分组" },
  { designFacetKey: "roles-and-perms", label: "角色与权限", group: "basic", ordinal: 4, required: false, initCategory: "角色分工" },
  { designFacetKey: "survey", label: "问卷", group: "pre-input", ordinal: 1, required: false, initCategory: "会前任务" },
  { designFacetKey: "interview-and-subjects", label: "访谈与对象", group: "pre-input", ordinal: 2, required: false, initCategory: "会前任务" },
  { designFacetKey: "pre-tasks", label: "会前任务", group: "pre-input", ordinal: 3, required: false, initCategory: "会前任务" },
  { designFacetKey: "venue-and-format", label: "场地与形式", group: "onsite", ordinal: 1, required: false, initCategory: "议程环节" },
  { designFacetKey: "project-materials", label: "项目材料", group: "onsite", ordinal: 2, required: false, initCategory: "材料清单" },
  { designFacetKey: "print-materials", label: "分组打印素材", group: "onsite", ordinal: 3, required: false, initCategory: "材料清单" },
  { designFacetKey: "group-capabilities", label: "组内能力", group: "onsite", ordinal: 4, required: false, initCategory: "分组" },
  { designFacetKey: "agent-orchestration", label: "Agent 编排", group: "ai", ordinal: 1, required: false, initCategory: "画布与产出物" },
  { designFacetKey: "skill-binding", label: "Skill 绑定", group: "ai", ordinal: 2, required: false, initCategory: "画布与产出物" },
  { designFacetKey: "outputs", label: "输出物", group: "output", ordinal: 1, required: false, initCategory: "画布与产出物" },
  { designFacetKey: "report-template", label: "报告模板", group: "output", ordinal: 2, required: false, initCategory: "画布与产出物" },
];

/**
 * 契约今天表达不了的那件事，登记在实现自己身上（`KNOWN_CONTRACT_GAPS` 的同款做法）。
 *
 * ⚠ 这不是 TODO：改契约是**人类**的动作（`contract-design.md` §五第 1 条 /
 * `contract-divergences.ts` 头注）。写在这里是为了让它**被看见**，而不是被实现绕过。
 */
export const DESIGN_FACET_CONTRACT_GAP =
  "contracts templates.DesignFacetDefinition has no `group` field, so listDesignFacetDefinitions " +
  "cannot carry the five closed groups that uc-2-1 V1 and domain.md I-20 both require. The grouping " +
  "therefore lives only in the domain table; a frontend that needs it must either get a contract " +
  "change (human action) or keep a second copy -- which is the exact failure mode I-5 exists to stop.";

/* ─────────────────────── 派生（全部读表，无第二份事实） ─────────────────────── */

/** 槽位清单 = 表里每一行的 key，**按序**。改表即改槽位。 */
export function designFacetKeys(table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS): string[] {
  return orderedDesignFacets(table).map((r) => r.designFacetKey);
}

/**
 * 完成度分母 = **表中已定义项数**（I-5）。
 *
 * ⚠ 它是一个**函数**而不是一个导出的常量：常量会被 import 到别处再存一遍，
 * 而「存下来的那一份」正是漂移发生的地方。
 */
export function designFacetDenominator(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): number {
  return table.length;
}

/** 必填槽位 = `required = true` 的行（I-6 的唯一驱动）。今天为空是**数据缺口 D-2**，不是没有门。 */
export function requiredDesignFacetKeys(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): string[] {
  return orderedDesignFacets(table)
    .filter((r) => r.required)
    .map((r) => r.designFacetKey);
}

/** 全局序：组顺序 × 组内序。UC-2.1 R3 的 1…15 由此派生，**不在表里存第二遍**。 */
export function orderedDesignFacets(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): DesignFacetRow[] {
  return [...table].sort(
    (a, b) =>
      DESIGN_FACET_GROUPS.indexOf(a.group) - DESIGN_FACET_GROUPS.indexOf(b.group) ||
      a.ordinal - b.ordinal,
  );
}

/**
 * 按五组分桶。**五个桶恒存在**——空组也要出现，
 * 否则「这一组今天没有配置项」与「我们不分这一组」不可分辨（同 `InitializationCategory` 恒 6 类的理由）。
 */
export function designFacetsByGroup(
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): Record<DesignFacetGroup, DesignFacetRow[]> {
  const buckets = Object.fromEntries(DESIGN_FACET_GROUPS.map((g) => [g, [] as DesignFacetRow[]])) as Record<
    DesignFacetGroup,
    DesignFacetRow[]
  >;
  for (const row of orderedDesignFacets(table)) buckets[row.group].push(row);
  return buckets;
}

/** 未在表中声明的 key 一律不是槽位（封闭性的可断言面）。 */
export function isDesignFacetKey(
  key: string,
  table: readonly DesignFacetRow[] = DESIGN_FACET_DEFINITIONS,
): boolean {
  return table.some((r) => r.designFacetKey === key);
}
