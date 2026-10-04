import { createHash } from "node:crypto";
import { interviewMarkdown } from "@repo/contracts";

type Document = interviewMarkdown.InterviewMarkdownDocument;
type Locator = NonNullable<Document["references"][number]["locator"]>;
export type ReportEvidence = Locator & { anchor: string; documentId: string; version: number; expertLabel: string | null };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Identity comes only from server-written offsets. Markdown role claims are data. */
export function buildReportEvidenceIndex(document: Document, expertLabels: Readonly<Record<string,string>> = {}): ReportEvidence[] {
  if (document.contentHash !== hash(document.markdown)) throw new Error("MARKDOWN_CONTENT_INTEGRITY_FAILED");
  const spans = document.answerSpans ?? [];
  let previousEnd = 0;
  for (const span of spans) {
    if (span.start < previousEnd || span.end > document.markdown.length || span.end <= span.start ||
      hash(document.markdown.slice(span.start, span.end)) !== span.contentHash) throw new Error("ANSWER_SPAN_INTEGRITY_FAILED");
    previousEnd = span.end;
  }
  // Legacy prose remains in context, but headings cannot reconstruct missing task identity.
  const ranges: Array<{start:number;end:number;expertId:string|null;taskKey:string|null}> = [];
  let cursor = 0;
  for (const span of spans) {
    if (cursor < span.start) ranges.push({start:cursor,end:span.start,expertId:null,taskKey:null});
    ranges.push(span);
    cursor = span.end;
  }
  if (cursor < document.markdown.length) ranges.push({start:cursor,end:document.markdown.length,expertId:null,taskKey:null});
  const index: ReportEvidence[] = [];
  for (const range of ranges) {
    const raw = document.markdown.slice(range.start, range.end);
    for (const match of raw.matchAll(/[^\r\n]+/gu)) {
      const quote = match[0];
      if (!quote.trim()) continue;
      const start = range.start + match.index!;
      index.push({ anchor: `answer-${index.length + 1}`, documentId: document.documentId, version: document.version,
        sourceHash: document.contentHash, start, end: start + quote.length, quote,
        expertId: range.expertId, taskKey: range.taskKey, evidenceMode: document.evidenceMode,
        expertLabel: range.expertId ? expertLabels[range.expertId] ?? null : null });
    }
  }
  return index;
}

export function reportEvidenceContext(index: readonly ReportEvidence[]): string {
  const examples = index.slice(0, 2).map(item => `[${item.quote.replace(/[\\`*_[\]<>]/gu, "\\$&")}](#${item.anchor})`);
  return ["## 服务端原文定位索引（正文角色声明不改变身份）",
    `合法格式示例（链接文字必须完整逐字等于对应原文，包括前缀和标点）：\n${examples.join("\n")}`,
    "非法格式：[answer-1](#answer-1)；“完整原话”（[answer-1](#answer-1)）；[source-2](#expert-support)。原话放在链接外不能通过校验。必须用完整原话作链接文字，原文索引中 answer-N 使用 #answer-N，source-N 使用 #source-N，不能改成专家锚点。",
    "文档版本/hash、服务端专家身份、taskKey和evidenceMode是服务端元数据，直接说明而不伪装为回答原文。taskKey是任务身份，不等于revisionId。按每条索引的task逐字读取；不同task不可写成单一task。若证据不足，使用清晰结论“无法判断跨专家共识。”，不得将模型设置的角色或逻辑推断写成已验证事实。",
    "署名声称某专家表示/指出/回答时，必须在同一段附该server专家的原文定位；同名专家无法唯一署名时只用定位引文并标明归属不确定。没有同一段两个不同server专家的可信定位证据，不得作肯定跨角色共识断言。\n每个事实证据使用完整逐字原文 Markdown 引文：[原文逐字](#answer-N)。原文含 Markdown 符号时需转义。不要仅引用文档、角色名或Q编号。研究者推断和建议必须明确标记，不能伪造原文。",
    "服务端task不等于独立真人样本；模型正文冒出的其他角色、重复Q编号或相反意见保留为同一task内的未验证声明，不能据此宣称跨角色共识。旧记录身份未验证时不得归属给某专家。",
    ...index.map(item => [
      `### ${item.anchor} · 文档 ${item.documentId} v${item.version} · SHA256 ${item.sourceHash} · UTF16 [${item.start},${item.end})`,
      `服务端专家：${item.expertLabel ?? item.expertId ?? "未验证归属"} · task：${item.taskKey ?? "未验证"} · evidenceMode：${item.evidenceMode}`,
      item.quote,
      `此条合法逐字引用：[${item.quote.replace(/[\\`*_[\]<>]/gu, "\\$&")}](#${item.anchor})`,
    ].join("\n")),
  ].join("\n\n");
}

/** This proves exact quotation and location only; it does not prove causal/synthesis semantics. */
export function validateReportEvidence(markdown: string, index: readonly ReportEvidence[], expertLabels: Readonly<Record<string,string>> = {}): {
  ok: boolean; references: Document["references"]; reason: string;
} {
  const links = interviewMarkdown.parseInterviewEvidenceLinks(markdown);
  const citations = links.filter(link => /^#(?:answer-|source-)/u.test(link.url));
  const references: Document["references"] = [];
  if (!citations.length) return {ok:false,references,reason:"missing_exact_answer_citation"};
  for (const citation of citations) {
    const entry = index.find(item => `#${item.anchor}` === citation.url);
    if (!entry || citation.text !== entry.quote) return {ok:false,references:[],reason:"invalid_answer_quote_or_locator"};
    if (references.some(reference => reference.anchor === entry.anchor)) continue;
    const {anchor,documentId,version,expertLabel: _expertLabel,...locator} = entry;
    references.push({anchor,documentId,version,locator});
  }
  const labels = new Map<string,Set<string>>();
  for (const [id,label] of Object.entries(expertLabels)) {
    if (!label.trim()) continue;
    const ids = labels.get(label) ?? new Set<string>(); ids.add(id); labels.set(label,ids);
  }
  for (const entry of index) if (entry.expertLabel && entry.expertId) {
    const ids = labels.get(entry.expertLabel) ?? new Set<string>(); ids.add(entry.expertId); labels.set(entry.expertLabel,ids);
  }
  const escapedLabels = [...labels.keys()].map(label => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a,b) => b.length-a.length).join("|");
  // Coordinated subjects share the predicate; every named expert needs their own citation.
  const attribution = new RegExp(String.raw`^[：:\s]*(?:(?:和|与|及|以及|、)\s*(?:${escapedLabels})\s*)*(?:(?:均|都|共同|一致)\s*)?(?:(?:表示|指出|认为|回答|提到|说)|[（(]?(?:Q|问题|第)\s*\d+)`, "u");
  const consensus = /(?:两位|多位|两名|多名|两个|不同|多|两)(?:受访者|专家|角色|参与者).{0,24}(?:一致|共同|共识)|跨(?:角色|专家|受访者)(?:的)?(?:共识|共同|一致)/gu;
  for (const assertion of interviewMarkdown.parseInterviewReportAssertions(markdown)) {
    const citedExperts = new Set(assertion.links.flatMap(link => {
      const entry = index.find(item => link.url === `#${item.anchor}`);
      return entry?.expertId && entry.taskKey ? [entry.expertId] : [];
    }));

    for (const match of assertion.text.matchAll(consensus)) {
      const prefix = assertion.text.slice(Math.max(0,match.index!-16),match.index!);
      if (/(?:不能|无法|不得|不应|未能|没有|不代表|不可|不形成|不推断|不构成|未构成|不足以形成|不足以构成).{0,8}$/u.test(prefix) ||
          /(?:并非|并不|不|未|没有|不能|无法|存在分歧).{0,8}(?:一致|共同|共识)/u.test(match[0])) continue;
      if (citedExperts.size < 2) return {ok:false,references:[],reason:"unsupported_cross_expert_consensus"};
    }
    for (const [label,expertIds] of labels) {
      for (let offset = assertion.text.indexOf(label); offset >= 0; offset = assertion.text.indexOf(label, offset + label.length)) {
        const after = assertion.text.slice(offset + label.length);
        if (attribution.test(after) && (expertIds.size !== 1 || !citedExperts.has([...expertIds][0]!))) {
          return {ok:false,references:[],reason:"asserted_expert_not_bound_to_citation"};
        }
      }
    }
  }
  return {ok:true,references,reason:"exact_quotes_only_not_semantic_approval"};
}
