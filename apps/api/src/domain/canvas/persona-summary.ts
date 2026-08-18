/**
 * `buildPersonaLanding` —— 把线程里的原始正文，收敛成一份可以直接落地为 Artifact 的
 * 「用户画像」画布文档（`summarizePersonaFromThread`，见 `packages/contracts/src/chat.ts`
 * 的 `KNOWN_CONTRACT_GAPS.C_CHAT_11`）。
 *
 * ## 解析器只有一份，权威在 `@repo/fabric-markdown`
 *
 * `persona` 是 canvas 束 19 个内置模板之一（`canvas.BUILTIN_CANVAS_TEMPLATES.persona`），
 * 它的字段清单、分区清单、文本语法（`字段: 值` / `## 分区名` / `- 要点`）与序列化规则
 * 全部已经在 `@repo/fabric-markdown` 里实现并被 164+ 个既有单测钉住（`persona.ts` /
 * `template-engine.ts`）。本文件**不重新发明**一套抽取规则——`getTemplate` /
 * `parseTemplateText` / `templateToModel` / `serializeTemplate` 直接从那份权威源码
 * 拿来用，同 `domain/canvas/mermaid-whitelist.ts` 复用 `extractMermaidBlocks` 的理由。
 *
 * ⚠ 只从 `/templates` 子路径导入（`templates-entry.ts`）：那个入口只激活
 *   `TemplateSpec` 注册，不触碰 `fabric` / `mermaid`，是 apps/api 这类没有 DOM lib
 *   的 Node 环境能安全导入的唯一入口——同 `mermaid-whitelist.ts` 文件头那条「为什么走
 *   子路径不走包根」的记录。
 *
 * ## 不编造（本文件存在的唯一理由）
 *
 * `parseTemplateText` 只识别**逐字匹配**的文本行；`templateToModel` 只把匹配到
 * `persona` 模板自己字段名/分区名的内容放进画布，其余一律忽略。于是「画像里出现了
 * 什么」严格等于「线程正文里逐字写过什么」——本文件加的唯一一层判断是
 * `matchedFieldCount + matchedBulletCount === 0` 时不生成看似完整实则空洞的画像，
 * 而是给一份**明说信息不足**的占位产物（V7 空态纪律的画像版）。
 */
import {
  getTemplate,
  parseTemplateText,
  serializeTemplate,
  templateToModel,
} from "@repo/fabric-markdown/templates";
// 六分区清单的唯一权威（同一模块也被 templates-entry 激活注册，Node 安全，
// 不触碰 fabric / mermaid）——不在本文件手抄第二份分区名。
import { PERSONA_SECTIONS } from "@repo/fabric-markdown/diagrams/persona";

export interface PersonaLandingDraft {
  readonly title: string;
  readonly payloadRef: string;
  /** false ⇒ 线程正文里一条可辨认的画像信息都没有找到；`payloadRef` 是占位模板。 */
  readonly sufficient: boolean;
}

const INSUFFICIENT_NOTICE =
  "> ⚠️ 信息不足，无法从当前对话内容生成完整的用户画像：对话正文中未出现可辨认的" +
  "画像字段（如「姓名: 」「职位: 」）或分区要点（如「## 目标和需求」下的「- 」列项）。" +
  "以下为空白模板占位，不代表任何真实用户信息。\n\n";

/**
 * `rawText` 是线程里全部消息正文按时间顺序拼接后的纯文本（调用方负责取数与判权，
 * 本函数是纯函数，不做 I/O）。
 */
export function buildPersonaLanding(rawText: string): PersonaLandingDraft {
  const spec = getTemplate("persona");
  if (!spec) {
    // 只在 `@repo/fabric-markdown` 的注册顺序被破坏时才会触发——`templates-entry.ts`
    // 顶部 `import './diagrams/persona'` 一旦被误删，这里第一时间炸，而不是悄悄
    // 生成一份没有任何字段/分区的「画像」。
    throw new Error(
      "persona 内置模板未注册 —— @repo/fabric-markdown 的 templates-entry.ts 缺了 " +
        "'./diagrams/persona' 的 import",
    );
  }

  const parsed = parseTemplateText(rawText);
  const matchedFieldCount = (spec.fields ?? []).filter(
    (field) => (parsed.fields.get(field) ?? "").trim().length > 0,
  ).length;
  const matchedBulletCount = spec.sections.reduce(
    (total, section) => total + (parsed.sections.get(section.name)?.length ?? 0),
    0,
  );
  const sufficient = matchedFieldCount > 0 || matchedBulletCount > 0;

  // `templateToModel` + `serializeTemplate` 走一遍完整往返：既是画布产物本身要用的
  // DiagramModel 生产路径，也顺带把「未识别字段一律不进模型」这条不变量再确认一次
  // （模型里没有的东西，序列化也不会凭空写回来）。
  const model = templateToModel(rawText, "persona");
  const personaFence = "```persona\n" + serializeTemplate(model) + "\n```\n";

  const name = parsed.fields.get("姓名")?.trim();
  const role = parsed.fields.get("职位")?.trim();
  const title = sufficient
    ? `用户画像 · ${name || role || "对话汇总"}`
    : "用户画像（信息不足）";

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
 * 六个一级分支 = `PERSONA_SECTIONS` 六分区、分支下挂 `parseTemplateText` 从正文里
 * **逐字识别**出的要点（与 `buildPersonaLanding` 同一个解析器，不另立抽取规则）。
 * `sufficient: false` 时六分支下各挂一个「信息不足」占位节点——不编造。
 *
 * 纯函数，不做 I/O；`sufficient` 由调用方从 `buildPersonaLanding` 拿（同一次判定，
 * 不在这里第二次实现「什么算信息足够」）。
 */
export function buildPersonaMindmapBody(input: {
  readonly rawText: string;
  readonly title: string;
  readonly sufficient: boolean;
}): string {
  const parsed = parseTemplateText(input.rawText);
  const lines: string[] = ["mindmap", `  root((${mindmapNodeText(input.title)}))`];
  for (const section of PERSONA_SECTIONS) {
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
