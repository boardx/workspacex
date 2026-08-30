/**
 * `buildPersonaLanding` —— 把线程里的原始正文，收敛成一份可以直接落地为 Artifact 的
 * 「用户画像」画布文档（`summarizePersonaFromThread`，见 `packages/contracts/src/chat.ts`
 * 的 `KNOWN_CONTRACT_GAPS.C_CHAT_11`）。
 *
 * ## 字段/分区清单不再由本文件（或包）单方面决定——调用方传，DB 是权威
 *
 * `persona` 是 canvas 束 19 个内置模板之一，但后台 template-admin 允许把它的字段/分区
 * 改名、重排、增删并发布新版（`canvas_template_registry`）。ChatUI「生成用户画像」曾经
 * 直接读 `@repo/fabric-markdown` 里写死的 9 字段/6 分区（中文字面名），从不查这张表——
 * 于是后台管理员改了模板，chat 生成的东西照旧是旧结构，两处看起来毫不相干（bug 现场：
 * template-admin 显示 15 个 `{{key}}` 字段 + 3×6 网格，chat 生成出来的画像还是老 9 字段
 * mindmap）。这与 `canvas-template-guidance.ts`（issue #1493）已经确立的原则相悖——
 * 「后台改模板，chat 不能靠写死在代码里的清单回答旧结构」——现在两条路径共用同一条纪律：
 * 字段/分区名一律由调用方（`summarize-persona-from-thread.ts`）从 DB 读出后传入本模块的
 * `PersonaTemplateFields`，本文件自己不再 import 任何模板注册表。
 *
 * `DEFAULT_PERSONA_TEMPLATE` 仍从 `@repo/fabric-markdown` 取——那是内置 `persona` 模板
 * 从未被组织自定义过时的默认字段/分区（`builtin-template-config.ts` 回填 DB 行用的
 * 同一份源码），只在调用方读不到已发布的 persona 模板行（组织没建、或读取失败）时兜底，
 * 不再是「唯一」事实源。
 *
 * ## 解析语法仍是一份：`@repo/fabric-markdown` 的 `parseTemplateText`
 *
 * 文本语法（`字段: 值` / `## 分区名` / `- 要点`）是与字段清单正交的另一件事——它不需要
 * 预先知道哪些字段/分区名合法就能把文本切开，本文件只是把切出来的结果拿去跟
 * `PersonaTemplateFields` 里**当次**的字段/分区名核对。继续复用它，不重新发明一套
 * 正则（同 `domain/canvas/mermaid-whitelist.ts` 复用 `extractMermaidBlocks` 的理由）。
 *
 * ⚠ 只从 `/templates` 子路径导入（`templates-entry.ts`）：那个入口只激活
 *   `TemplateSpec` 注册，不触碰 `fabric` / `mermaid`，是 apps/api 这类没有 DOM lib
 *   的 Node 环境能安全导入的唯一入口——同 `mermaid-whitelist.ts` 文件头那条「为什么走
 *   子路径不走包根」的记录。
 *
 * ## 不编造（本文件存在的唯一理由没变）
 *
 * `parseTemplateText` 只识别**逐字匹配**的文本行；本文件只把匹配到当次
 * `PersonaTemplateFields` 里字段名/分区名的内容放进画布，其余一律忽略。于是「画像里
 * 出现了什么」严格等于「线程正文里逐字写过什么」——本文件加的唯一一层判断是
 * `matchedFieldCount + matchedBulletCount === 0` 时不生成看似完整实则空洞的画像，
 * 而是给一份**明说信息不足**的占位产物（V7 空态纪律的画像版）。
 */
import { parseTemplateText, type ParsedTemplateText } from "@repo/fabric-markdown/templates";
// 内置默认值的唯一来源（不是唯一事实源——见文件头）：组织没有自定义过 persona 模板时
// 的兜底字段/分区名，与 `builtin-template-config.ts` 回填 DB 行用的同一份源码。
import { PERSONA_FIELDS, PERSONA_SECTIONS } from "@repo/fabric-markdown/diagrams/persona";

/**
 * 一次画像生成要用的字段（表头）/分区（正文）名清单——由调用方从 DB 里当次已发布的
 * `persona` 模板行读出后传入，本文件不持有、也不缓存它。
 */
export interface PersonaTemplateFields {
  readonly fields: readonly string[];
  readonly sections: readonly string[];
}

/** 组织从未自定义过 persona 模板时的兜底——见文件头。 */
export const DEFAULT_PERSONA_TEMPLATE: PersonaTemplateFields = {
  fields: [...PERSONA_FIELDS],
  sections: [...PERSONA_SECTIONS],
};

export interface PersonaLandingDraft {
  readonly title: string;
  readonly payloadRef: string;
  /** false ⇒ 线程正文里一条可辨认的画像信息都没有找到；`payloadRef` 是占位模板。 */
  readonly sufficient: boolean;
}

/**
 * 按 `tpl` 的字段/分区顺序，把 `parsed` 里逐字匹配到的内容序列化成一段 ```persona 围栏体
 * （不含围栏本身）。等价于 `template-engine.ts` 的 `serializeTemplate`，但不依赖那份
 * 只注册了内置 19 个模板几何的**静态**全局表——字段/分区名是当次动态传入的，静态表压根
 * 不知道组织自定义过什么。
 */
function serializePersonaFence(parsed: ParsedTemplateText, tpl: PersonaTemplateFields): string {
  const lines: string[] = [];
  for (const field of tpl.fields) {
    const value = (parsed.fields.get(field) ?? "").trim();
    if (value) lines.push(`${field}: ${value}`);
  }
  for (const section of tpl.sections) {
    const items = parsed.sections.get(section) ?? [];
    if (items.length === 0) continue;
    lines.push("");
    lines.push(`## ${section}`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join("\n").replace(/^\n/, "");
}

const INSUFFICIENT_NOTICE =
  "> ⚠️ 信息不足，无法从当前对话内容生成完整的用户画像：对话正文中未出现可辨认的" +
  "画像字段（如「姓名: 」「职位: 」）或分区要点（如「## 目标和需求」下的「- 」列项）。" +
  "以下为空白模板占位，不代表任何真实用户信息。\n\n";

/**
 * `rawText` 是线程里全部消息正文按时间顺序拼接后的纯文本（调用方负责取数与判权，
 * 本函数是纯函数，不做 I/O）。`tpl` 是当次要用的字段/分区名——调用方从 DB 里已发布的
 * `persona` 模板行读出后传入；省略时退回 `DEFAULT_PERSONA_TEMPLATE`（组织从未自定义过）。
 */
export function buildPersonaLanding(
  rawText: string,
  tpl: PersonaTemplateFields = DEFAULT_PERSONA_TEMPLATE,
): PersonaLandingDraft {
  const parsed = parseTemplateText(rawText);
  const matchedFieldCount = tpl.fields.filter(
    (field) => (parsed.fields.get(field) ?? "").trim().length > 0,
  ).length;
  const matchedBulletCount = tpl.sections.reduce(
    (total, section) => total + (parsed.sections.get(section)?.length ?? 0),
    0,
  );
  const sufficient = matchedFieldCount > 0 || matchedBulletCount > 0;

  const personaFence = "```persona\n" + serializePersonaFence(parsed, tpl) + "\n```\n";

  // 标题用第一个有值的表头字段——不再硬编码「姓名」/「职位」这两个具体字段名,
  // 组织把表头字段整个换掉（如截图里的 name/job_title 英文 key 对应的中文名）也一样适用。
  const primary = tpl.fields.map((field) => parsed.fields.get(field)?.trim()).find((v) => !!v);
  const title = sufficient ? `用户画像 · ${primary || "对话汇总"}` : "用户画像（信息不足）";

  return {
    title,
    payloadRef: sufficient ? personaFence : INSUFFICIENT_NOTICE + personaFence,
    sufficient,
  };
}

/* ── mindmap 消息体（design-delta chat-persona-roundtrip G2，confirmed 2026-08-18）── */

/**
 * `sufficient: false` 时六分支下各挂的占位节点文案。固定字符串，测试可逐字比对
 * （「不编造」断言的锚点：占位不含任何未在线程正文出现过的实体词）。
 */
export const PERSONA_MINDMAP_INSUFFICIENT_NODE = "信息不足";

/**
 * mermaid mindmap 节点文本消毒：mindmap 语法用 `()[]{}` 表达节点形状、按行分节点，
 * 正文里逐字出现这些字符会被 mermaid 当结构解析（轻则漂移重则 parse 失败，前端
 * 的诚实错误态会把整张图打成错误框）。替换为全角同形字符——语义可读性不变，
 * 不再是结构字符。换行折叠成空格，超长截断（mindmap 是概览，不是全文搬运）。
 */
function mindmapNodeText(raw: string): string {
  const swapped = raw
    .replace(/\(/g, "（").replace(/\)/g, "）")
    .replace(/\[/g, "【").replace(/\]/g, "】")
    .replace(/\{/g, "｛").replace(/\}/g, "｝")
    .replace(/"/g, "”").replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return swapped.length > 80 ? `${swapped.slice(0, 79)}…` : swapped;
}

/**
 * 把线程正文收敛成一条 assistant 消息的正文：一个 ```mermaid mindmap 围栏。
 * 根节点 = 画像名（调用方传 `buildPersonaLanding` 算出的 title，同一事实源不重算）、
 * 一级分支 = `sections`（调用方从 DB 已发布 persona 模板行读出，与 `buildPersonaLanding`
 * 用的是同一份 `PersonaTemplateFields.sections`，省略时退回 `DEFAULT_PERSONA_TEMPLATE`
 * 六分区），分支下挂 `parseTemplateText` 从正文里**逐字识别**出的要点（与
 * `buildPersonaLanding` 同一个解析器，不另立抽取规则）。
 * `sufficient: false` 时各分支下各挂一个「信息不足」占位节点——不编造。
 *
 * 纯函数，不做 I/O；`sufficient` 由调用方从 `buildPersonaLanding` 拿（同一次判定，
 * 不在这里第二次实现「什么算信息足够」）。
 */
export function buildPersonaMindmapBody(input: {
  readonly rawText: string;
  readonly title: string;
  readonly sufficient: boolean;
  readonly sections?: readonly string[];
}): string {
  const parsed = parseTemplateText(input.rawText);
  const sections = input.sections ?? DEFAULT_PERSONA_TEMPLATE.sections;
  const lines: string[] = ["mindmap", `  root((${mindmapNodeText(input.title)}))`];
  for (const section of sections) {
    lines.push(`    ${mindmapNodeText(section)}`);
    const bullets = input.sufficient
      ? (parsed.sections.get(section) ?? [])
      : [PERSONA_MINDMAP_INSUFFICIENT_NODE];
    for (const bullet of bullets) {
      const text = mindmapNodeText(bullet);
      if (text.length > 0) lines.push(`      ${text}`);
    }
  }
  return "```mermaid\n" + lines.join("\n") + "\n```\n";
}
