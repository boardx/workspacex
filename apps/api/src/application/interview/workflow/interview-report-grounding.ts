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
  const taskCount = new Set(index.flatMap(item => item.taskKey ? [item.taskKey] : [])).size;
  const expertCount = new Set(index.flatMap(item => item.taskKey && item.expertId ? [item.expertId] : [])).size;
  const examples = index.slice(0, 2).map(item => `[${item.quote.replace(/[\\`*_[\]<>&]/gu, "\\$&")}](#${item.anchor})`);
  return ["## 服务端原文定位索引（正文角色声明不改变身份）",
    `服务端已绑定任务数：${taskCount}；画像数：${expertCount}。只按索引的taskKey区分任务，revision不是任务。归属已绑定不等于真人身份已验证；模拟画像仍非真人。没有taskKey的材料归属未验证，不能给它分配画像。正文用可读画像名和任务数，不打印技术ID，不把不同任务合成单一任务，也不从这些计数猜测问答数。`,
    "服务端问答数量状态：不可确定。当前源契约绑定整段任务输出与原文行定位，逐问答身份未验证；answer-N是原文行定位，answerSpan绑定的是整段任务输出，二者都不是问答单位。报告省略问答数量，仅使用已绑定任务数、画像数和原文内容范围；原文Q编号或章节标题也不能确认问答计数。",
    `合法格式示例（链接文字必须完整逐字等于对应原文，包括前缀和标点）：\n${examples.join("\n")}`,
    "非法格式：[answer-1](#answer-1)；“完整原话”（[answer-1](#answer-1)）；[source-2](#expert-support)。原话放在链接外不能通过校验。必须用完整原话作链接文字，原文索引中 answer-N 使用 #answer-N，source-N 使用 #source-N，不能改成专家锚点。",
    "文档版本/hash、服务端专家身份、taskKey和evidenceMode是服务端元数据，直接说明而不伪装为回答原文。taskKey是任务身份，不等于revisionId。按每条索引的task逐字读取；不同task不可写成单一task。若证据不足，使用清晰结论“无法判断跨专家共识。”，不得将模型设置的角色或逻辑推断写成已验证事实。",
    "署名声称某专家表示/指出/回答时，必须在同一段附该server专家的原文定位；同名专家无法唯一署名时只用定位引文并标明归属不确定。没有同一段两个不同server专家的可信定位证据，不得作肯定跨角色共识断言。\n每个事实证据使用完整逐字原文 Markdown 引文：[原文逐字](#answer-N)。原文含 Markdown 符号时需转义。不要仅引用文档、角色名或Q编号。研究者推断和建议必须明确标记，不能伪造原文。",
    "服务端task不等于独立真人样本；模型正文冒出的其他角色、重复Q编号或相反意见保留为同一task内的未验证声明，不能据此宣称跨角色共识。旧记录身份未验证时不得归属给某专家。",
    ...index.map(item => [
      `### ${item.anchor} · 文档 ${item.documentId} v${item.version} · SHA256 ${item.sourceHash} · UTF16 [${item.start},${item.end})`,
      `服务端专家：${item.expertLabel ?? item.expertId ?? "未验证归属"} · task：${item.taskKey ?? "未验证"} · evidenceMode：${item.evidenceMode}`,
      item.quote,
      `引用定位：#${item.anchor}；使用上一行完整原文作链接文字。`,
    ].join("\n")),
  ].join("\n\n");
}

/** This proves exact quotation and location only; it does not prove causal/synthesis semantics. */
export function validateReportEvidence(markdown: string, index: readonly ReportEvidence[], expertLabels: Readonly<Record<string,string>> = {}, options: { requireCitation?: boolean } = {}): {
  ok: boolean; references: Document["references"]; reason: string;
} {
  const links = interviewMarkdown.parseInterviewEvidenceLinks(markdown);
  const citations = links.filter(link => /^#(?:answer-|source-)/u.test(link.url));
  const references: Document["references"] = [];
  if (!citations.length && options.requireCitation !== false) return {ok:false,references,reason:"missing_exact_answer_citation"};
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
    // Finite observed overclaims: exact quotations do not establish population
    // frequency or inevitable purchasing causality. Keep raw candidate bytes.
    // Internal causal/additive conjunctions keep local denial scope; explicit
    // affirmation after an additive conjunction starts a separate assertion.
    for (const clause of assertion.text.split(/[，,。；;\n]|但是|然而|不过|反而|仍然|而且(?=事实上|实际|确实)|(?<!因|从|进|继)而(?!且)|但|(?<!冷)却/u)) {
      for (const overclaim of clause.matchAll(/最常见|必然(?:阻止|阻碍|导致|影响)(?:采购|购买)/gu)) {
        const before = clause.slice(0, overclaim.index);
        const after = clause.slice(overclaim.index! + overclaim[0].length);
        const conclusion = /(?:不能|不可|无法|不应|不得)得出([“"「‘]?)([^，,。；;“”"「」‘’]{0,16})$/u.exec(before);
        const closingQuote: Readonly<Record<string,string>> = {"": "", "“": "”", "\"": "\"", "「": "」", "‘": "’"};
        const close = conclusion ? closingQuote[conclusion[1]!] : undefined;
        // The finite frame can contain coordinated predicates or causal words.
        // A prior closed unquoted conclusion cannot qualify a new assertion;
        // literal “结论” inside the current paired quotation is still its content.
        const tail = after.slice(0,64);
        const end = close === undefined ? -1 : close ? tail.indexOf(close) : tail.search(/的(?:无条件)?结论/u);
        const continuation = end >= 0 ? tail.slice(0,end) : "";
        const qualifiedConclusion = close !== undefined && end >= 0
          && !/[，,。；;“”"「」‘’]/u.test(continuation)
          && (close !== "" || !/的(?:无条件)?结论/u.test(conclusion![2]! + continuation))
          && /^的(?:无条件)?结论/u.test(after.slice(end + close.length));
        // A direct prohibition on inventing statistics also scopes the following
        // assertion, but not a contrast or unrelated earlier disclaimer.
        const qualified = /(?:不能|不可|无法|不应|不得)(?:凭空)?(?:补充|编造|虚构)(?:样本)?统计来(?:断言|声称|认为|证明|说)[^，,。；;]{0,16}$/u.test(before)
          || /(?:不能|不可|无法|不应|不得)(?:断言|声称|认为|证明|说)[^，,。；;]{0,16}$/u.test(before)
          // Bare 不断言 only scopes this finite predicate coordination, never an unrelated object or a new assertion frame.
          || /^\s*不断言(?:(?:最常见|极高风险)(?:、|或|及|与|和|\s)*)*(?:某条件)?$/u.test(before)
          || /(?:不能|不可|无法|不应|不得)\s*$/u.test(before)
          || qualifiedConclusion
          || /^\s*(?:若|如果|假如)[^，,。；;]*$/u.test(before);
        const doubleDenial = /否认|否定|并非|并无|绝非|不是|不会|不曾|没有|不可能/u.test(before);
        if (!qualified || doubleDenial) return {ok:false,references:[],reason:"unsupported_evidence_strength"};
      }
    }
    const citedExperts = new Set(assertion.links.flatMap(link => {
      const entry = index.find(item => link.url === `#${item.anchor}`);
      return entry?.expertId && entry.taskKey ? [entry.expertId] : [];
    }));

    for (const match of assertion.text.matchAll(consensus)) {
      if (negatesConsensus(assertion.text, match.index!, match[0])) continue;
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

/** Only a scoped denial of this predicate removes a consensus assertion. */
function negatesConsensus(text: string, start: number, match: string): boolean {
  // A preceding clause or a contrast cannot negate the new positive assertion.
  const clause = text.slice(0, start + match.length).split(/[，,。！？；;\n]|但是|然而|不过|反而|仍然|而(?:要|应|是)|但|(?<!冷)却/u).at(-1) ?? "";
  const negatives = [...clause.matchAll(/并无|绝非|不足以形成|不足以构成|不代表|不形成|不推断|不构成|未构成|不能|无法|不得|不应|未能|没有|不可|并非|并不|不(?!同)|未/gu)];
  if (negatives.length !== 1) return false; // Double denial cannot waive evidence.
  const negative = negatives[0]!;
  const tail = clause.slice(negative.index! + negative[0].length).trim();
  if (/否认|否定|排除/u.test(clause)) return false;
  const predicate = String.raw`[“‘"'\s]*(?:跨(?:角色|专家|受访者)(?:的)?|(?:两位|多位|两名|多名|两个|不同|多|两)(?:受访者|专家|角色|参与者)(?:的)?)?(?:完全|基本|充分|高度)?(?:共识|共同|一致)`;
  const direct = new RegExp(String.raw`^(?:(?:判断|推断|形成|构成|证明|达成|存在|确认|断言|宣称|声称|代表|采信|作肯定)(?:为|成)?)?${predicate}$`, "u");
  const object = new RegExp(String.raw`^(?:将|把).+?(?:宣称|声称|判断|推断|认为|定义|断言|虚构)(?:为|成)?${predicate}$`, "u");
  // A scoped denial of using this consensus as a basis needs the basis noun
  // immediately after the matched predicate; an unrelated earlier denial cannot waive it.
  const basis = new RegExp(String.raw`^作为(?:[^，,。！？；;\n]{1,40}(?:或|和|及|与))?${predicate}$`, "u");
  const after = text.slice(start + match.length);
  const basisDenied = basis.test(tail) && /^[”’"' \t]*的依据/u.test(after);
  const merged = new RegExp(String.raw`^合并(?:宣称|声称|断言)(?:为|成)?${predicate}$`, "u");
  // The observed coordination shares one local denied judgment, with no object scanning.
  const taskExpertJudgment = /^判断跨任务(?:或|和)跨专家(?:的)?共识$/u.test(tail);
  return direct.test(tail) || taskExpertJudgment || object.test(tail) || basisDenied || merged.test(tail);
}
