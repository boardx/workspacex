import { createHash } from "node:crypto";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { isAidtGreetingText, isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";

type Draft = SharedStageValue["content"]["draft"];
const sections: Record<string, string> = {
  候选研究方向: "directionsText", 本轮选定方向: "selectedText", 本组选择的研究方向: "selectedText", 本组选定的研究方向: "selectedText", "选题价值（学生说明）": "whyWorthStudying", "选题价值（学生陈述）": "whyWorthStudying", 原始命题: "initial", 初始问题: "initial", 选题价值: "whyWorthStudying", 选题理由: "whyWorthStudying",
  来源类型: "problemSources", 问题来源: "problemSources", 命题来源反思: "sourceDetails", 来源说明: "sourceDetails", 来源描述: "sourceDetails", 尚未确定: "sourceUncertainty", 尚不确定: "sourceUncertainty",
  已知: "known", "未知/待讨论": "sourceUncertainty", 待验证: "sourceUncertainty", 未知: "sourceUncertainty", "当前已知/假设与未知缺口": "sourceUncertainty",
  下一步行动: "nextAction", 学生重写命题: "rewrittenTheme", 研究范围: "focus",
};

/** Parse the named sections of the Skill's visible draft, including pre-protocol Markdown.
 * Never take the first chat message or a teaching question as a saved answer. */
export function problemSkillFields(answer: string, assistantMarkdown = true): Record<string, string> {
  if (answer.length > 100_000) return {};
  const fields: Record<string, string> = {};
  const headingPrefix = assistantMarkdown ? /^#{1,6}[ \t]+(?:\d{1,2}[.)、][ \t]+)?/u : /^#{1,6}\s+/u;
  let current: string | undefined;
  for (const line of answer.split(/\r?\n/)) {
    const text = line.trim().replace(headingPrefix, "").replace(/^[-*]\s+/, "").replaceAll("**", "");
    const separator = text.search(/[：:]/);
    const label = (separator < 0 ? text : text.slice(0, separator)).trim().replace(/\s*(?:（(?:逐字保留|学生表述)）|\((?:逐字保留|学生表述)\))$/u, "")
      .replace(/\s*[／/]\s*/g, "/");
    // Newly supported student source aliases need the attribution-aware paired
    // declaration reader below; AI Markdown alone cannot supply their authority.
    if (Object.hasOwn(sections, label) && (assistantMarkdown || !["问题来源", "来源描述"].includes(label))) {
      current = sections[label];
      const inline = separator < 0 ? "" : text.slice(separator + 1).trim();
      if (current && inline) fields[current] = inline.slice(0, 650);
      continue;
    }
    if (/^\s*(?:---+|#{1,6}\s|\*\*[^*]+\*\*\s*$)/.test(line)) { current = undefined; continue; }
    // One contiguous paragraph or list per field. Later teaching prose is not artifact content.
    if (!line.trim() && current && fields[current]) { current = undefined; continue; }
    if (current && line.trim()) {
      const value = line.trim();
      // The assistant may render the student's statement or selection as a Markdown blockquote.
      // Decode one marker after recognizing the field, before comparing to the student's wording.
      const literal = assistantMarkdown && (current === "initial" || current === "rewrittenTheme" || current === "selectedText")
        ? value.replace(/^>[ \t]/u, "")
        : value;
      fields[current] = [fields[current], literal].filter(Boolean).join("\n").slice(0, 650);
    }
  }
  for (const [key,value] of Object.entries(fields)) if (isAidtProblemControlText(value)) delete fields[key];
  if (fields.problemSources) {
    const codes: Record<string, string> = { "亲自观察":"observation", "听到抱怨":"complaint", "我们的猜测":"guess", ...(assistantMarkdown ? { "猜测":"guess" } : {}) };
    const labels = fields.problemSources.split(/[、，,；;]/).map(value => value.trim());
    if (labels.every(label => Object.hasOwn(codes,label))) fields.problemSources = JSON.stringify([...new Set(labels.map(label => codes[label]))]);
    else delete fields.problemSources;
  }
  return fields;
}

function studentProblemStatement(text: string): string | undefined {
  const value = text.trim();
  if (value.length < 12 || value.length > 650 || isAidtGreetingText(value)) return undefined;
  // Preserve the student's literal input when a substantive research statement is explicit.
  const clauses = value.split(/[。\n]/u).map(clause => clause.trim());
  const hasStatement = clauses.some(clause => /^(?:(?:原始命题|初始问题)[：:]\s*\S|(?:我们|我)?(?:想了解|想研究|希望了解|希望研究|想弄清|想探索).{6,}|我在.{4,}希望.{4,})/u.test(clause));
  return hasStatement ? value : undefined;
}

// A structured answer may quote a previous teaching reply. Only inspect the
// student's section for new explicit source or selection statements.
export function studentRevisionText(user: string): string {
  const marker = [...user.matchAll(/^学生的回答[：:][^\S\r\n]*$/gmu)].at(-1);
  return marker ? user.slice(marker.index + marker[0].length) : user;
}

const quoteContextText = (line: string) => line.trim().replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").replaceAll("**", "");
function declaresComparisonQuote(line: string): boolean {
  const text = quoteContextText(line);
  // An explicit AI/example preface retains its attribution after the following
  // colon is split into source declarations. Copying a reply is not adopting it.
  if (/^(?:(?:AI(?:助手)?|人工智能|助手|模型)(?:(?:的|给出的|提供的)?(?:示例|例子|回复|回答|建议)|说|写道|表示)|(?:复制|引用|转述|粘贴)(?:的)?(?:AI(?:助手)?|人工智能|助手|模型)(?:的)?(?:示例|例子|回复|回答|建议))(?:[：:]|\s*$)/iu.test(text)
    || /^(?:以上|上述|上面|前面|刚才|这段|这些|这只是|这不是)[^。！？\r\n]{0,20}(?:AI(?:助手)?|人工智能|助手|模型)(?:的|给出的|提供的)?(?:示例|例子|回复|回答|建议)(?:[：:。]|\s*$)/iu.test(text)) return true;
  const opening = /^(?:下面|下列|以下|以上|上面|上述|前面|刚才|这里|这段|这些|这是|这不是|先看|请看|(?:我们)?(?:先)?(?:引用|转述|参考|对照)|这只是|这(?:段|些)?不是|不是|不代表|不作为|(?:老师|教师|引导师)(?:的|给的|提供的)?(?:示例|例子|举例|原话|追问))/u.test(text);
  if (!opening) return false;
  return /(?:老师|教师|引导师)[^。！？\r\n]{0,40}(?:示例|例子|举例|原话|追问|引用|对照)|(?:引用|转述)[^。！？\r\n]{0,40}(?:老师|教师|引导师)/u.test(text)
    || /(?:不是|不代表|不作为)[^。！？\r\n]{0,12}(?:我们|本组|小组|我)[^。！？\r\n]{0,12}(?:命题|问题|研究决定|研究方向|决定|选择|来源|材料)/u.test(text)
    || /^(?:引用|转述|对照)[：:]\s*$/u.test(text)
    || /^(?:下面|下列|以下|以上|上面|上述|这里|这段|这|这些)[^。！？\r\n]{0,20}(?:仅(?:作|供)?|只是|只(?:作|供))[^。！？\r\n]{0,12}(?:引用|示例|例子|对照)/u.test(text);
}

function declaresEarlierComparisonQuote(line: string): boolean {
  return /^(?:以上|上述|上面|前面|刚才|这段|这些|这只是|这不是|不是|不代表|不作为)/u.test(quoteContextText(line))
    && declaresComparisonQuote(line);
}

/** Preserve literal student wording, including a leading greater-than sign.
 * Only a quote block explicitly identified as comparison material is excluded. */
export function studentProblemAttributionText(user: string): string {
  const lines = studentRevisionText(user).split(/\r?\n/);
  const quoted = (line: string) => /^[ \t]{0,3}>/u.test(line);
  const following: boolean[] = [];
  let context = false;
  for (let index = lines.length - 1; index >= 0; index--) {
    following[index] = context;
    if (lines[index]!.trim() && !quoted(lines[index]!)) {
      // A preface for the next example must not reclassify the previous quote.
      context = declaresEarlierComparisonQuote(lines[index]!);
    }
  }
  let previous: "student" | "comparison" | "other" = "other";
  return lines.filter((line, index) => {
    if (!quoted(line)) {
      if (line.trim()) previous = /^(?:(?:我们|本组|我|学生)(?:的)?)?(?:原始命题|初始问题)[：:]\s*$/u.test(quoteContextText(line))
        ? "student" : declaresComparisonQuote(line) ? "comparison" : "other";
      return true;
    }
    return previous === "student" || previous !== "comparison" && !following[index];
  }).join("\n");
}

function explicitlyStatedHypothesis(prose: string): string | undefined {
  const sentences = prose.split(/(?<=[。！？])|\r?\n/u).map(value => value.trim());
  return sentences.find(value => /^(?:上述|这些)(?:行为|情况|说法)(?:目前|现在)?只是我们(?:提出的)?(?:假设|猜测)[。！]?$/u.test(value)
    || /^这(?:目前|现在)?只是我们(?:提出的)?(?:假设|猜测)[。！]?$/u.test(value));
}

/** Accept an affirmative student source statement, not an inference from missing
 * evidence or an assistant's classification. Preserve its literal explanation. */
function explicitlyStatedGuessSource(prose: string): string | undefined {
  const statements: Array<{ text: string; guess: boolean; paragraph: number; forward: boolean }> = [];
  let comparison = false, fenced = false, paragraph = 0;
  for (const line of prose.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/u.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^[ \t]{0,3}>/u.test(line)) continue;
    if (!line.trim()) { comparison = false; paragraph++; continue; }
    const exampleLead = /^(?:例如|比如|示例|例子)(?:[：:（(。]|$)|^(?:老师|教师|引导师)(?:说|问|举例|引用|转述)(?:的)?(?:示例|例子|原话)?[：:。]/u.test(quoteContextText(line));
    if (exampleLead || declaresComparisonQuote(line)) {
      statements.push({ text: line.trim(), guess: false, paragraph, forward: !declaresEarlierComparisonQuote(line) }); comparison = true; continue;
    }
    if (comparison) continue;
    for (const value of line.split(/(?<=[。！？])/u).map(sentence => sentence.trim()).filter(Boolean)) {
      const statement = { text: value, guess: false, paragraph, forward: false }; statements.push(statement);
      if (declaresComparisonQuote(value)) { statement.forward = !declaresEarlierComparisonQuote(value); comparison = true; break; }
      if (!/^(?:(?:我们|本组|我)(?:的)?)?选题来源(?:是|为)(?:我们的|本组的|我的)?猜测(?:[；;，,。.]|$)/u.test(value)
        || value.length > 650 || /[?？]/u.test(value)
        || /选题来源[^。！？]{0,12}(?:尚未确定|尚未决定|暂未确定|暂未决定|未定|不确定)|(?:尚未|暂未|还没(?:有)?)(?:确定|决定|确认)(?:选题)?来源/u.test(value)
        || /(?:不是|不代表|不作为)[^。！？]{0,12}(?:本组|我们|我)[^。！？]{0,12}(?:来源|判断|说法)/u.test(value)
        || value.split(/[；;，,]/u).some(clause => declaresComparisonQuote(clause.trim().replace(/^(?:但|不过)\s*/u, "")))) continue;
      statement.guess = true;
    }
  }
  // Read this paragraph before accepting its source. A later retrospective
  // attribution can retract earlier statements even across ordinary explanation.
  // A new forward example starts a separate attribution scope.
  return statements.find((statement, index) => {
    if (!statement.guess) return false;
    for (let following = index + 1; following < statements.length; following++) {
      const next = statements[following]!;
      if (next.paragraph !== statement.paragraph || next.forward) break;
      const sourceDecision = next.text.split(/[；;，,]/u, 1)[0]!.trim();
      const sourceUndecided = /^(?:(?:我们|本组|我|目前|现在)\s*)*(?:还没(?:有)?|尚未|暂未|没有|未)(?:确定|决定|确认)(?:本轮|这次)?(?:的)?(?:选题)?来源[。.]?$/u.test(sourceDecision)
        || /^(?:(?:我们|本组|我)的)?(?:选题)?来源(?:目前|现在)?(?:还没(?:有)?|尚未|暂未|没有|未)(?:确定|决定|确认)[。.]?$/u.test(sourceDecision);
      if (declaresEarlierComparisonQuote(next.text) || sourceUndecided) return false;
    }
    return true;
  })?.text;
}

// A deferred decision is not permission for the assistant to choose or rewrite.
// Keep explicit student selections and rewrites independent of one another.
function studentDefersDecision(text: string): boolean {
  // Only an opening student operation counts as deferral. A research question
  // about users who did not choose something is still substantive wording.
  const control = text.trim().split(/[，,。！？；;\r\n]/u, 1)[0]!.trim();
  return /^(?:(?:但|不过|我们|本组|我|目前|现在|本轮|这轮|先|暂时|暂且)\s*)*(?:还没(?:有)?|尚未|暂未|仍未|还未|没有|没|未|暂不|不|不要|不想|不打算|不准备|不急(?:于|着))(?:(?:先|现在|正式|继续|开始|完成|进行|替我们|帮我们|做出)\s*)*(?:(?:重写|改写|重拟|修订)(?:命题|问题)?|(?:选择|选定|选|确定|确认|决定)(?:(?:具体|合适的?|新的?|任何|其他|另一个|第[一二三四五六七八九十\d]+个)?(?:研究)?方向|命题|题目)?)(?:了|好|完|下来|清楚)?$/u.test(control)
    || /^(?:(?:但|不过|我们|本组|我|目前|现在|本轮|这轮)\s*)*(?:研究)?方向(?:还没(?:有)?|尚未|暂未|仍未|还未|没有|未|没)(?:定|确定|决定|选定)(?:好|下来|清楚)?$/u.test(control);
}
function studentShortSelection(text: string): string | undefined {
  return /(?:^|[。！？；;\r\n])\s*(?:我们|本组|我)?(?:已经|明确|最终|决定|就)?(?:选择|选定|选(?!题)|确定|确认)(?:(?:研究)?方向(?:为|是)?|了)?[：:]?\s*([^，,。！？；;\r\n]{1,120})/u.exec(text)?.[1]?.trim();
}

/** Narrow natural aliases remain student declarations, never assistant inference.
 * Read the attribution paragraph before accepting a value, including retractions. */
function naturalStudentDeclaration(prose: string, kind: "source" | "rewrite", hasInitial = false): { value: string; source?: string } | undefined {
  // Split only before another explicit student operation, not every sentence:
  // a source explanation may itself contain several literal sentences.
  const lines = prose.split(/\r?\n/).flatMap(line => line.split(/(?<=[。！？：:])(?=\s*(?:(?:问题来源|来源类型|来源描述|来源说明|选题理由|选题价值|尚不确定)[：:]|(?:(?:我们|本组|我)(?:的|将命题|把命题)?)?(?:(?:选题|问题)?来源(?:是|为|来自)|重写为|(?:已经|明确|最终|决定|就)?(?:选择|选定|选(?!题)|确定|确认)|(?:暂不|尚未|暂未|还没(?:有)?|没有|未)(?:选择|选定|重写|改写|确定|确认))))/u));
  let comparison = false, fenced = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (/^(?:```|~~~)/u.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^>/u.test(line)) continue;
    if (!line) { comparison = false; continue; }
    if (declaresComparisonQuote(line) || /^(?:例如|比如|示例|例子)(?:[：:（(。]|$)|^(?:老师|教师|引导师)(?:说|问|举例|引用|转述)/u.test(quoteContextText(line))) { comparison = true; continue; }
    if (comparison) continue;
    // A source description can be supplied independently in a later turn.
    const sourceType = kind === "source" ? /^(?:问题来源|来源类型)[：:]\s*(亲自观察|听到抱怨|我们的猜测|猜测)[。.]?$/u.exec(line) : null;
    const sourceExplanation = sourceType ? /^(?:来源描述|来源说明)[：:]\s*(\S.*)$/u.exec(lines[index + 1]?.trim() ?? "") : null;
    const standaloneDescription = kind === "source" ? /^来源描述[：:]\s*(\S.*)$/u.exec(line) : null;
    const match = sourceType && sourceExplanation ? [line, sourceType[1], sourceExplanation[1]]
      : standaloneDescription ? [line, undefined, standaloneDescription[1]]
      : kind === "source" ? /^(?:(?:我们|本组|我)(?:的)?)?(?:选题|问题)?来源(?:是|为|来自)\s*(亲自观察|听到抱怨|我们的猜测|猜测)(?:[：:]\s*(\S.*)|[。.]?)$/u.exec(line)
      : /^(?:(?:我们|本组|我)(?:将命题|把命题)?)?(?:重写为|改写为|(?:学生)?(?:改写|重写)命题)[：:]\s*(\S.*)$/u.exec(line)
        ?? (hasInitial ? /^命题是[：:]\s*(\S.*)$/u.exec(line) : null);
    if (!match) continue;
    let value = match[kind === "source" ? 2 : 1]?.trim() ?? "";
    if (kind === "source" && value) {
      for (let continuation = index + (sourceExplanation ? 2 : 1); continuation < lines.length; continuation++) {
        const next = lines[continuation]!.trim();
        const label = quoteContextText(next).split(/[：:]/u, 1)[0]!.trim();
        if (!next || /^(?:>|```|~~~|#{1,6}\s|---+)/u.test(next) || Object.hasOwn(sections, label)
          || declaresComparisonQuote(next)
          || /^(?:(?:我们|本组|我)(?:的|将命题|把命题)?)?(?:(?:选题|问题)?来源(?:是|为|来自)|重写为|(?:研究价值|选题价值|选题理由)(?:是|为))/u.test(next)
          || studentShortSelection(next) || studentDefersDecision(next)) break;
        value += "\n" + lines[continuation]!;
      }
    }
    if (value.length > 650 || (value && isAidtProblemControlText(value)) || studentDefersDecision(value)
      || /^(?:暂无|未定|待定|还没定|没想好|尚未重写|暂未重写|待重写|待补充)[。.]?$/u.test(value)
      || kind === "source" && /[?？]/u.test(line)
      || value.split(/[；;，,。！？]/u).some(clause => declaresComparisonQuote(clause.trim())
        || /^(?:例如|比如|示例|例子)(?:[：:（(。]|$)|^(?:老师|教师|引导师)(?:说|问|举例|引用|转述)|^(?:只是|仅(?:作|供)?|只(?:作|供))\s*(?:老师|教师|引导师)(?:的)?(?:示例|例子|原话)/u.test(clause.trim()))) continue;
    let retracted = false, followingFenced = false;
    // The opening declaration belongs to the same scope as any later explanation.
    // A new forward example is separate; retrospective attribution is not.
    for (let following = index; following < lines.length; following++) {
      const next = lines[following]!.trim();
      if (/^(?:```|~~~)/u.test(next)) { followingFenced = !followingFenced; continue; }
      if (followingFenced || /^>/u.test(next)) continue;
      if (!next || following > index && declaresComparisonQuote(next) && !declaresEarlierComparisonQuote(next)) break;
      const clauses = next.split(/[；;，,。！？]/u).map(clause => clause.trim().replace(/^(?:但|不过)\s*/u, ""));
      if (declaresEarlierComparisonQuote(next) || clauses.some(clause => declaresComparisonQuote(clause)
        || kind === "source" && /^(?:(?:我们|本组|我|目前|现在)\s*)*(?:(?:撤回|收回)(?:上述|刚才|这个|该)?(?:的)?(?:选题|问题)?来源(?:声明|说法|判断)?|(?:还没(?:有)?|尚未|暂未|没有|未)(?:确定|决定|确认)(?:选题|问题)?来源|(?:选题|问题)?来源(?:尚未确定|尚未决定|暂未确定|暂未决定|未定|不确定))/u.test(clause)
        || kind === "rewrite" && (/^(?:(?:但|不过|我们|本组|我|目前|现在|本轮|这轮|先|暂时|暂且)\s*)*(?:还没(?:有)?|尚未|暂未|仍未|还未|没有|没|未|暂不|不|不要|不想|不打算|不准备|不急(?:于|着))(?:(?:先|现在|正式|继续|开始|完成|进行|替我们|帮我们|做出)\s*)*(?:重写|改写|重拟|修订)(?:命题|问题)?(?:了|好|完|下来|清楚)?$/u.test(clause)
          || /^(?:(?:我们|本组|我)\s*)*(?:撤回|收回)(?:上述|刚才|这个|该)?(?:的)?(?:重写|改写)(?:命题|问题)?/u.test(clause)))) { retracted = true; break; }
    }
    if (!retracted) {
      if (kind === "rewrite") return { value };
      const source = standaloneDescription && /^(?:我(?:们)?|本组)(?:亲耳)?听到[^。！？；;]*抱怨/u.test(value)
        ? "听到抱怨" : match[1];
      return { value, ...(source ? { source } : {}) };
    }
  }
  return undefined;
}

const withoutFinalPeriod = (value: string | undefined) => value?.trim().replace(/[。.]$/u, "");

export function projectProblemSkillDraft(draft: Draft, entityId: string, turn: { user:string; assistant:string; messageId:string; verifiedInitial?: string }): Draft | null {
  if (isAidtCandidateRequest(turn.user, "problem") || isAidtGreetingText(turn.user.trim())) return null;
  const key = "problemDraft:" + entityId;
  let previous: Record<string,string>;
  try { previous = JSON.parse(draft.fields[key] ?? "{}"); } catch { return null; }
  if (!previous || typeof previous !== "object" || Array.isArray(previous) || Object.values(previous).some(v=>typeof v!=="string")
    || previous.draftTurnId === turn.messageId) return null;
  const student = studentRevisionText(turn.user);
  const initialAttribution = studentProblemAttributionText(turn.user);
  const output = problemSkillFields(turn.assistant);
  if (output.initial) {
    const existing = previous.initial?.trim();
    // Students' first framing stays intact. A later reformulation has its own field.
    if ((existing && !isAidtProblemControlText(existing)) ||
        (!initialAttribution.includes(output.initial) && turn.verifiedInitial !== output.initial)) delete output.initial;
  }
  if (!output.initial && (!previous.initial?.trim() || isAidtProblemControlText(previous.initial.trim()))) {
    const initial = studentProblemStatement(initialAttribution);
    if (!initial || isAidtProblemControlText(initial)) return null;
    output.initial = initial;
  }
  const {directionsText,selectedText,...patch}=output;
  const selectedByStudent = /^(?:本组选择的研究方向|本轮选定方向)[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim() || studentShortSelection(student);
  const statedSelection = selectedByStudent && !studentDefersDecision(selectedByStudent) && !/^(?:暂无|未定|待定|还没定|没想好)[。.]?$/u.test(selectedByStudent) ? selectedByStudent : undefined;
  const rewrittenByStudent = naturalStudentDeclaration(student, "rewrite", Boolean(previous.initial?.trim() && !isAidtProblemControlText(previous.initial)))?.value;
  const statedRewrite = rewrittenByStudent && !studentDefersDecision(rewrittenByStudent)
    && !/^(?:暂无|未定|待定|还没定|没想好|尚未重写|暂未重写|待重写|待补充)[。.]?$/u.test(rewrittenByStudent) ? rewrittenByStudent : undefined;
  // Each consequential field needs its own student expression. Asking for a
  // comparison permits suggestions, not a selected direction or a student rewrite.
  // The student wording suffices when the reply has no dedicated rewrite field.
  if (statedRewrite && (!patch.rewrittenTheme || patch.rewrittenTheme === statedRewrite)) patch.rewrittenTheme = statedRewrite;
  else delete patch.rewrittenTheme;
  if (!statedSelection) delete patch.focus;
  const studentFields = problemSkillFields(student, false);
  const sourceTypeLine = /^来源类型[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim();
  const statedSourceType = sourceTypeLine ? problemSkillFields("来源类型：" + sourceTypeLine, false).problemSources : studentFields.problemSources;
  const statedSourceDetails = /^(?:命题来源反思|来源说明)[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim() || studentFields.sourceDetails;
  const hypothesis = explicitlyStatedHypothesis(student);
  if (hypothesis) {
    patch.problemSources = JSON.stringify(["guess"]);
    patch.sourceDetails = hypothesis;
  } else {
    const naturalSource = statedSourceType ? undefined : naturalStudentDeclaration(student, "source");
    const naturalGuess = statedSourceType ? undefined : explicitlyStatedGuessSource(student);
    if (statedSourceType) patch.problemSources = statedSourceType;
    else if (naturalSource?.source) patch.problemSources = JSON.stringify([naturalSource.source === "亲自观察" ? "observation" : naturalSource.source === "听到抱怨" ? "complaint" : "guess"]);
    else if (naturalGuess) patch.problemSources = JSON.stringify(["guess"]);
    else delete patch.problemSources;
    if (statedSourceDetails) patch.sourceDetails = statedSourceDetails;
    else if (naturalSource?.value) patch.sourceDetails = naturalSource.value;
    else if (naturalGuess) patch.sourceDetails = naturalGuess;
    else delete patch.sourceDetails;
  }
  type Direction = { id:string; title:string; source:string };
  let priorDirections: Direction[] = [];
  try {
    const existing:unknown = JSON.parse(previous.problemDirections ?? "[]");
    if (Array.isArray(existing)) priorDirections = existing.filter((d): d is Direction =>
      d && typeof d.id === "string" && typeof d.title === "string" && ["group","ai"].includes(d.source));
  } catch { /* Old incomplete choices can be replaced by an explicit new list. */ }
  let choices = priorDirections;
  if (directionsText) {
    let directions=directionsText.split("\n").flatMap(line=>{
      const m=/^[-*] (小组|AI)[：:]\s*(.{1,120})$/u.exec(line);
      if (!m) return [];
      const title=m[2]!.trim(), source=m[1]==="小组"?"group":"ai";
      const id=priorDirections.find(choice=>choice.title===title)?.id ?? createHash("sha256").update(title).digest("hex").slice(0,24);
      return [{id,title,source}];
    }).slice(0,6);
    if (directions.length) {
      // Fresh AI suggestions cannot revoke an existing student choice.
      const priorSelected = priorDirections.find(choice => choice.id === previous.problemDirectionId);
      if (priorSelected && !directions.some(choice => choice.id === priorSelected.id)) directions = [priorSelected, ...directions].slice(0, 6);
      patch.problemDirections=JSON.stringify(directions);
      choices = directions;
    }
  }
  let selection = statedSelection ? choices.find(choice => withoutFinalPeriod(choice.title) === withoutFinalPeriod(statedSelection)) : undefined;
  if (statedSelection && withoutFinalPeriod(statedSelection) !== withoutFinalPeriod(selectedText ?? patch.focus)) {
    selection = undefined;
    delete patch.focus;
  } else if (statedSelection && !selection && statedSelection.length <= 120) {
    selection = {
      id: createHash("sha256").update(statedSelection).digest("hex").slice(0,24),
      title: statedSelection,
      source: "group",
    };
    // Keep prior choices when there is room and make the newly selected group
    // direction part of the same list the confirmation UI validates.
    patch.problemDirections = JSON.stringify([...choices.slice(0, 5), selection]);
  }
  if (selection) { patch.problemDirectionId = selection.id; patch.focus = selection.title; }
  if (!Object.entries(patch).some(([key,value])=>previous[key]!==value)) return null;
  const next: Record<string,string> = { ...previous, ...patch, draftTurnId: turn.messageId };
  // The old confirmed revision remains in the stage ledger and its top-level handoff is untouched.
  delete next.roundCompletion;
  delete next.problemReflectionConfirmed;
  const value = JSON.stringify(next);
  return value.length <= 6000 ? { ...draft, fields: { ...draft.fields, [key]: value } } : null;
}
