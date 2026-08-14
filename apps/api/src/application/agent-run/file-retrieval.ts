/**
 * F155 L3 —— **文件式检索**（design delta `context-engine-l3-file-based`，人类 2026-08-14 签核）。
 *
 * ## 这个文件是什么，不是什么
 *
 * 它是 L3「这个线程/项目里还有哪些相关**文件**」这一层的端口与纯组装逻辑。
 * 它**不是**既有五路召回引擎（`application/retrieval/` + `application/context-pack/`）的
 * 替代或分支——delta §2 明确：那条引擎一行不动、不作废，为将来 embedding provider 落地后
 * 并入留着。本文件与它零耦合：不 import 它的任何符号，不复用它的失败纪律。
 *
 * ## 与五路召回引擎**刻意相反**的一条：失败降级，不 block
 *
 * `retrieveCandidates` 的纪律是「任一路失败即整体 block」（`RetrievalUnavailableError` →
 * `RETRIEVAL_UNAVAILABLE`），因为它有五路要融合排序，缺一路的排序结果是错的、不是少的。
 * 文件式检索是**单路径、无融合**：查询失败时「本次没召回到文件」是一个诚实的答案，不是一个
 * 被污染的答案。所以 delta §3.3 要求它降级为空、run 照常完成（verification V6，且 V6 的反证
 * 就是「若实现误套用了 block 那条纪律，本断言会红」）。降级发生在 `execute-run.ts` 的调用点
 * （那里有 `deps.log`），本文件只保证自己不抛。
 *
 * ## 权限：SQL 谓词自带，不是「召回了再过滤」
 *
 * `FileRetrievalScope` 是**查询条件**，不是事后筛子——实现（`pg-file-retrieval.ts`）把它编译进
 * WHERE 子句，越权的行**不会被查出来**（delta §3.1、verification V4）。个人线程（`projectId`
 * 为 null）走 F156 delta 已签的受限路径：只吃本线程、且线程创建者是 actor 的附件
 * （`own_attachment_retrieval` 允许，`cross_scope_retrieval_requests` 恒 0）。
 */
import type { OrgId } from "../../domain/org-id";
import type { ThreadHistoryMessage } from "./ports";

/** 一次 L3 召回最多带回几条命中。 */
export const FILE_RETRIEVAL_MAX_HITS = 5;

/**
 * 单条命中在伪消息里最多占多少字符（围绕命中关键词开窗，见 `windowExcerpt`）。
 * 与 L1 的 `HISTORY_MAX_CHARS`(12000) 是**不同**的预算：L3 是加在 L1 之上的额外上下文，
 * 必须自己有界，否则「召回」会悄悄把每次 model 调用撑大一倍。
 */
export const FILE_RETRIEVAL_EXCERPT_MAX_CHARS = 1_200;

/** 一次 L3 召回整条伪消息的总字符上限（所有命中相加）。 */
export const FILE_RETRIEVAL_TOTAL_MAX_CHARS = 4_000;

/**
 * 落地产物写进 `chat_artifact_landings.content_excerpt` 的字符上限。
 * **唯一事实源在这里**（迁移文件刻意不复述这个数值，见其头注）。
 */
export const LANDED_CONTENT_EXCERPT_MAX_CHARS = 4_000;

/**
 * 命中来源的类别标记。verification V2 要求「来源标记区分于附件」——所以它是一个封闭枚举，
 * 逐字进入伪消息文本（模型看得到「这段话是从哪种文件来的」），也让测试能精确断言来源。
 */
export type FileRetrievalSourceKind = "chat-attachment" | "canvas-artifact";

/** 一条命中。`text` 是**未开窗**的原文摘录，开窗在 `buildFileContextMessage` 里做（纯、可测）。 */
export interface FileRetrievalHit {
  readonly kind: FileRetrievalSourceKind;
  /** 文件名（附件）或产物标题（画布产物）——进伪消息，让模型能引用「哪份文件」。 */
  readonly title: string;
  readonly text: string;
  /** `ts_rank` 的原始值，越大越相关。仅用于排序与可观测，不进伪消息文本。 */
  readonly rank: number;
}

/**
 * 检索范围锚点。**这三个字段就是权限本身**（编译进 SQL 的 WHERE），不是给事后过滤用的提示。
 *
 * `projectId === null` ⇔ 个人线程（`chat_threads.project_id` 可空自 #594）——两条**不同**的
 * 查询分支，不是同一条查询的一个可选参数，同 `resolveVisibility` 的 `projectId: string | null`
 * 那条既有先例（它自己的注释逐字写着这是「两条不同判定分支的选择器」）。
 */
export interface FileRetrievalScope {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly actorUserId: string;
}

export interface FileRetrievalPort {
  /**
   * 按关键词全文检索本 scope 内可见的「文件」。
   *
   * 抛错是允许的（DB 抖动、索引缺失）——调用点降级为「本次未召回」，绝不 fail run。
   * 返回空数组与抛错在**行为上不同**：前者是「查了，没有相关文件」，后者是「没查成」，
   * 调用点分别留不同的日志，不把两者混成一个「反正没召回」。
   */
  search(
    orgId: OrgId,
    scope: FileRetrievalScope,
    query: string,
    limit: number,
  ): Promise<readonly FileRetrievalHit[]>;
}

/**
 * 从本轮输入文本里抽出用于开窗定位的关键词。
 *
 * ⚠ 这**不是**查询解析——真正的查询解析由 Postgres 的 `plainto_tsquery` 做（唯一事实源在
 * SQL 那侧）。这里只回答一个纯展示问题：「摘录该从哪个字符位置开始截」。所以规则可以粗：
 * 按非字母数字切分、留长度 ≥2 的 token，外加原样保留连字符形式（代号常长成 `ZEPHYR-7742`）。
 */
export function queryTermsForWindowing(query: string): readonly string[] {
  const terms = new Set<string>();
  for (const raw of query.split(/[^\p{L}\p{N}_-]+/u)) {
    const token = raw.trim().toLowerCase();
    if (token.length >= 2) terms.add(token);
    // `ZEPHYR-7742` 同时贡献它自己和两个半段——半段命中也足以把窗口对准正确的位置。
    for (const part of token.split("-")) {
      if (part.length >= 2) terms.add(part);
    }
  }
  return [...terms];
}

/**
 * 围绕**第一个命中关键词**开一个 `maxChars` 宽的窗。
 *
 * 为什么不是「取前 N 字」：一份 4000 字的抽取摘录里，关键词可能在第 3000 字——取前 1200 字
 * 会把召回变成一个看起来在工作、实际永远命中不到正文的空壳（verification V1 断言的正是
 * 「内容含那份附件里的**相关**片段」）。
 *
 * 一个关键词都没命中时退回取前 `maxChars` 字（DB 那侧已经判定这行相关，展示层不该因为
 * 自己的粗糙分词就把它变成空串）。
 */
export function windowExcerpt(
  text: string,
  terms: readonly string[],
  maxChars: number,
): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const haystack = text.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    const at = haystack.indexOf(term);
    if (at !== -1 && (hit === -1 || at < hit)) hit = at;
  }
  if (hit === -1) return `${text.slice(0, maxChars)}…`;
  // 命中点尽量居中；贴到文本任一端时把窗口整体推回去，保证窗宽恒为 maxChars。
  let start = Math.max(0, hit - Math.floor(maxChars / 2));
  if (start + maxChars > text.length) start = Math.max(0, text.length - maxChars);
  const slice = text.slice(start, start + maxChars);
  return `${start > 0 ? "…" : ""}${slice}${start + maxChars < text.length ? "…" : ""}`;
}

/** 人读/模型读的来源标签。枚举值本身逐字进文本，测试据此断言来源区分（V2）。 */
function renderHit(hit: FileRetrievalHit, terms: readonly string[]): string {
  const label = hit.kind === "chat-attachment" ? "聊天附件" : "画布产物";
  const excerpt = windowExcerpt(hit.text, terms, FILE_RETRIEVAL_EXCERPT_MAX_CHARS);
  return `［${hit.kind} · ${label}：${hit.title}］\n${excerpt}`;
}

/**
 * 把命中组装成**一条** `role/content` 伪消息前置到 history。
 *
 * `ModelCallInput`/`ModelCallPort` 的形状一字节不动（verification V8）——L3 与 L2 走同一条
 * 「端口内侧组装、契约不变」的路子，不为检索新开一个 message 字段或一个新 role。
 *
 * `role: "assistant"` 与 L2 摘要伪消息一致：这段文字不是用户说的话，把它伪装成用户输入会让
 * 模型误以为人类刚刚粘贴了这些内容。零命中 ⇒ 返回 `null`（不插一条「没找到相关文件」的噪声，
 * 那会诱导模型去讨论检索这件事本身）。
 */
export function buildFileContextMessage(
  hits: readonly FileRetrievalHit[],
  query: string,
): ThreadHistoryMessage | null {
  if (hits.length === 0) return null;
  const terms = queryTermsForWindowing(query);
  const rendered: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const block = renderHit(hit, terms);
    // 总预算是硬的：装不下的命中整条丢弃，不截半句——半句摘录会让模型引用一个不存在的
    // 句子（同 `trimHistoryToBudget` 那条「按条丢弃、绝不编辑一条」的既有纪律）。
    if (used + block.length > FILE_RETRIEVAL_TOTAL_MAX_CHARS && rendered.length > 0) break;
    rendered.push(block);
    used += block.length;
  }
  if (rendered.length === 0) return null;
  return {
    role: "assistant",
    content: `[检索到的相关文件（共 ${rendered.length} 份）]\n${rendered.join("\n\n")}`,
  };
}
