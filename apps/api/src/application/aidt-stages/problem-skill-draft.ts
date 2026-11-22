import { createHash } from "node:crypto";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { isAidtGreetingText, isAidtProblemControlText, type SharedStageValue } from "@repo/contracts/aidt-stages";

type Draft = SharedStageValue["content"]["draft"];
const sections: Record<string, string> = {
  候选研究方向: "directionsText", 本轮选定方向: "selectedText", 原始命题: "initial", 初始问题: "initial", 选题价值: "whyWorthStudying", 选题理由: "whyWorthStudying",
  来源类型: "problemSources", 命题来源反思: "sourceDetails", 来源说明: "sourceDetails",
  已知: "known", "未知/待讨论": "sourceUncertainty", 待验证: "sourceUncertainty", 未知: "sourceUncertainty",
  下一步行动: "nextAction", 学生重写命题: "rewrittenTheme", 研究范围: "focus",
};

/** Parse the named sections of the Skill's visible draft, including pre-protocol Markdown.
 * Never take the first chat message or a teaching question as a saved answer. */
export function problemSkillFields(answer: string): Record<string, string> {
  if (answer.length > 100_000) return {};
  const fields: Record<string, string> = {};
  let current: string | undefined;
  for (const line of answer.split(/\r?\n/)) {
    const text = line.trim().replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").replaceAll("**", "");
    const separator = text.search(/[：:]/);
    const label = (separator < 0 ? text : text.slice(0, separator)).trim().replace(/\s*[／/]\s*/g, "/");
    if (Object.hasOwn(sections, label)) {
      current = sections[label];
      const inline = separator < 0 ? "" : text.slice(separator + 1).trim();
      if (current && inline) fields[current] = inline.slice(0, 650);
      continue;
    }
    if (/^\s*(?:---+|#{1,6}\s|\*\*[^*]+\*\*\s*$)/.test(line)) { current = undefined; continue; }
    // One contiguous paragraph or list per field. Later teaching prose is not artifact content.
    if (!line.trim() && current && fields[current]) { current = undefined; continue; }
    if (current && line.trim()) fields[current] = [fields[current], line.trim()].filter(Boolean).join("\n").slice(0, 650);
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

export function projectProblemSkillDraft(draft: Draft, entityId: string, turn: { user:string; assistant:string; messageId:string; verifiedInitial?: string }): Draft | null {
  if (isAidtCandidateRequest(turn.user, "problem") || isAidtGreetingText(turn.user.trim())) return null;
  const key = "problemDraft:" + entityId;
  let previous: Record<string,string>;
  try { previous = JSON.parse(draft.fields[key] ?? "{}"); } catch { return null; }
  if (!previous || typeof previous !== "object" || Array.isArray(previous) || Object.values(previous).some(v=>typeof v!=="string")
    || previous.draftTurnId === turn.messageId) return null;
  const output = problemSkillFields(turn.assistant);
  if (output.initial) {
    const existing = previous.initial?.trim();
    // Students' first framing stays intact. A later reformulation has its own field.
    if ((existing && !isAidtProblemControlText(existing)) ||
        (!turn.user.includes(output.initial) && turn.verifiedInitial !== output.initial)) delete output.initial;
  }
  if (!output.initial && (!previous.initial?.trim() || isAidtProblemControlText(previous.initial.trim()))) {
    const initial = studentProblemStatement(turn.user);
    if (!initial || isAidtProblemControlText(initial)) return null;
    output.initial = initial;
  }
  const {directionsText,selectedText,...patch}=output;
  type Direction = { id:string; title:string; source:string };
  let priorDirections: Direction[] = [];
  try {
    const existing:unknown = JSON.parse(previous.problemDirections ?? "[]");
    if (Array.isArray(existing)) priorDirections = existing.filter((d): d is Direction =>
      d && typeof d.id === "string" && typeof d.title === "string" && ["group","ai"].includes(d.source));
  } catch { /* Old incomplete choices can be replaced by an explicit new list. */ }
  let choices = priorDirections;
  if (directionsText) {
    const directions=directionsText.split("\n").flatMap(line=>{
      const m=/^[-*] (小组|AI)[：:]\s*(.{1,120})$/u.exec(line);
      if (!m) return [];
      const title=m[2]!.trim(), source=m[1]==="小组"?"group":"ai";
      const id=priorDirections.find(choice=>choice.title===title)?.id ?? createHash("sha256").update(title).digest("hex").slice(0,24);
      return [{id,title,source}];
    }).slice(0,6);
    if (directions.length) {
      patch.problemDirections=JSON.stringify(directions);
      choices = directions;
      if (previous.problemDirectionId && !directions.some(choice=>choice.id===previous.problemDirectionId)) patch.problemDirectionId="";
    }
  }
  const selection = choices.find(choice => choice.title === selectedText);
  if (selection) { patch.problemDirectionId = selection.id; patch.focus = selection.title; }
  if (!Object.entries(patch).some(([key,value])=>previous[key]!==value)) return null;
  const next: Record<string,string> = { ...previous, ...patch, draftTurnId: turn.messageId };
  // The old confirmed revision remains in the stage ledger and its top-level handoff is untouched.
  delete next.roundCompletion;
  delete next.problemReflectionConfirmed;
  const value = JSON.stringify(next);
  return value.length <= 6000 ? { ...draft, fields: { ...draft.fields, [key]: value } } : null;
}
