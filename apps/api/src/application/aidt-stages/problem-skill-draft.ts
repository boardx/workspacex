import { createHash } from "node:crypto";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { isAidtGreetingText, isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";

type Draft = SharedStageValue["content"]["draft"];
const sections: Record<string, string> = {
  候选研究方向: "directionsText", 本轮选定方向: "selectedText", 本组选择的研究方向: "selectedText", 原始命题: "initial", 初始问题: "initial", 选题价值: "whyWorthStudying", 选题理由: "whyWorthStudying",
  来源类型: "problemSources", 命题来源反思: "sourceDetails", 来源说明: "sourceDetails",
  已知: "known", "未知/待讨论": "sourceUncertainty", 待验证: "sourceUncertainty", 未知: "sourceUncertainty", "当前已知/假设与未知缺口": "sourceUncertainty",
  下一步行动: "nextAction", 学生重写命题: "rewrittenTheme", 研究范围: "focus",
};

/** Parse the named sections of the Skill's visible draft, including pre-protocol Markdown.
 * Never take the first chat message or a teaching question as a saved answer. */
export function problemSkillFields(answer: string, unwrapVerbatimQuote = false): Record<string, string> {
  if (answer.length > 100_000) return {};
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const line of answer.split(/\r?\n/)) {
    const text = line.trim().replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").replaceAll("**", "");
    const separator = text.search(/[：:]/);
    const label = (separator < 0 ? text : text.slice(0, separator)).trim().replace(/\s*(?:（(?:逐字保留|学生表述)）|\((?:逐字保留|学生表述)\))$/u, "")
      .replace(/\s*[／/]\s*/g, "/");
    if (Object.hasOwn(sections, label)) {
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
      // The assistant may render a literal problem statement as a Markdown blockquote.
      // Decode one marker after recognizing the field, before comparing to the student's wording.
      const literal = unwrapVerbatimQuote && (current === "initial" || current === "rewrittenTheme")
        ? value.replace(/^>[ \t]/u, "")
        : value;
      fields[current] = [fields[current], literal].filter(Boolean).join("\n").slice(0, 650);
    }
  }
  for (const [key,value] of Object.entries(fields)) if (isAidtProblemControlText(value)) delete fields[key];
  if (fields.problemSources) {
    const codes: Record<string, string> = { "亲自观察":"observation", "听到抱怨":"complaint", "我们的猜测":"guess" };
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

function explicitlyStatedHypothesis(prose: string): string | undefined {
  const sentences = prose.split(/(?<=[。！？])|\r?\n/u).map(value => value.trim());
  return sentences.find(value => /^(?:上述|这些)(?:行为|情况|说法)(?:目前|现在)?只是我们(?:提出的)?(?:假设|猜测)[。！]?$/u.test(value)
    || /^这(?:目前|现在)?只是我们(?:提出的)?(?:假设|猜测)[。！]?$/u.test(value));
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
  return /(?:^|[。！？；;\r\n])\s*(?:我们|本组|我)?(?:已经|明确|最终|决定|就)?(?:选择|选定|选|确定|确认)(?:(?:研究)?方向(?:为|是)?|了)?[：:]?\s*([^，,。！？；;\r\n]{1,120})/u.exec(text)?.[1]?.trim();
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
  const output = problemSkillFields(turn.assistant, true);
  if (output.initial) {
    const existing = previous.initial?.trim();
    // Students' first framing stays intact. A later reformulation has its own field.
    if ((existing && !isAidtProblemControlText(existing)) ||
        (!student.includes(output.initial) && turn.verifiedInitial !== output.initial)) delete output.initial;
  }
  if (!output.initial && (!previous.initial?.trim() || isAidtProblemControlText(previous.initial.trim()))) {
    const initial = studentProblemStatement(student);
    if (!initial || isAidtProblemControlText(initial)) return null;
    output.initial = initial;
  }
  const {directionsText,selectedText,...patch}=output;
  const selectedByStudent = /^(?:本组选择的研究方向|本轮选定方向)[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim() || studentShortSelection(student);
  const statedSelection = selectedByStudent && !studentDefersDecision(selectedByStudent) && !/^(?:暂无|未定|待定|还没定|没想好)[。.]?$/u.test(selectedByStudent) ? selectedByStudent : undefined;
  const rewrittenByStudent = /^学生重写命题[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim();
  const statedRewrite = rewrittenByStudent && !studentDefersDecision(rewrittenByStudent)
    && !/^(?:暂无|未定|待定|还没定|没想好|尚未重写|暂未重写|待重写|待补充)[。.]?$/u.test(rewrittenByStudent) ? rewrittenByStudent : undefined;
  // Each consequential field needs its own student expression. Asking for a
  // comparison permits suggestions, not a selected direction or a student rewrite.
  if (!statedRewrite || statedRewrite !== patch.rewrittenTheme) delete patch.rewrittenTheme;
  if (!statedSelection) delete patch.focus;
  const studentFields = problemSkillFields(student);
  const sourceTypeLine = /^来源类型[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim();
  const statedSourceType = sourceTypeLine ? problemSkillFields("来源类型：" + sourceTypeLine).problemSources : studentFields.problemSources;
  const statedSourceDetails = /^(?:命题来源反思|来源说明)[：:]([^\r\n]+)$/mu.exec(student)?.[1]?.trim() || studentFields.sourceDetails;
  const hypothesis = explicitlyStatedHypothesis(student);
  if (hypothesis) {
    patch.problemSources = JSON.stringify(["guess"]);
    patch.sourceDetails = hypothesis;
  } else {
    if (statedSourceType) patch.problemSources = statedSourceType;
    else delete patch.problemSources;
    if (statedSourceDetails) patch.sourceDetails = statedSourceDetails;
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
