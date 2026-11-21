import { aidtBrainstormTitle, AIDT_BRAINSTORM_METHODS, readAidtBrainstorms } from "@repo/contracts/aidt-brainstorm";
import type { AidtUiField, AidtUiStageDraft } from "./aidt-ui-drafts";
import { listAidtProblems, readAidtProblemEntityDraft } from "./aidt-problem-entities";
import { formatAidtProblemReflectionMarkdown } from "./aidt-problem-reflection";
import { isAidtInterviewArchived, isAidtInterviewConfirmed, readAidtInterviews, readAidtInterviewMaterials, readAidtInterviewTranscript } from "./aidt-interviews";
import { aidtResearchMaterialLabel } from "./aidt-research-material-reference";
import { readAidtDefinition, readAidtDefinitionSelection } from "./aidt-definition";
import { readAidtIdeaHandoffIds, readAidtIdeaHmwSource, readAidtIdeaSheetIds } from "./aidt-idea-handoff";
import { isAidtPrototypeHandoffConfirmed, readAidtConfirmedPrototypeHandoff, readAidtPrototypeEntityDraft, readAidtPrototypeInputSelection } from "./aidt-prototype-handoff";
import { readAidtPrototypeReference } from "./aidt-prototype-reference";
import { formatAidtVerificationMarkdown } from "./aidt-verification-loop";
import { readAidtTestGroups } from "./aidt-test-groups";

const value = (text: string | undefined) => text?.trim() || "未记录";
const state = (record: { archived: boolean; confirmed: boolean }) => record.archived ? "已归档，保留历史" : record.confirmed ? "学生已确认记录，不等于研究已验证" : "草稿，待学生核对";
const fields = (draft: AidtUiStageDraft, definitions: readonly AidtUiField[]) => definitions.flatMap(field => [`${field.label}：${value(draft.fields[field.id])}`]);
function unreadable(draft: AidtUiStageDraft, prefix: string, count: number, label: string) {
  return Object.keys(draft.fields).filter(key => key.startsWith(prefix)).length > count ? [`部分${label}格式无法读取；原记录保留，请回来源版本核对。`] : [];
}

/** Project-owned records already loaded by the caller. No fetching, writes or invented outcomes. */
export function aidtEntityReportLines(stage: number, draft: AidtUiStageDraft, definitions: readonly AidtUiField[]): string[] {
  if (stage === 1) {
    const entries = listAidtProblems(draft);
    return [...entries.flatMap(entry => {
      const problem = readAidtProblemEntityDraft(draft, entry.id);
      return [
        `### 问题记录：${entry.title}`,
        `记录 ID：${entry.id}；${entry.archived ? "已归档，保留历史" : draft.fields.problemHandoffEntity === entry.id ? "本轮交接所记录的问题；确认效力请核对阶段回执" : "候选问题，不自动作为本轮结论"}`,
        ...fields(problem, definitions), ...formatAidtProblemReflectionMarkdown(problem), "",
      ];
    }), ...unreadable(draft, "problemEntity:", entries.length, "问题记录")];
  }
  if (stage === 2) {
    const interviews = readAidtInterviews(draft.fields);
    return [...interviews.flatMap(interview => {
      const transcript = readAidtInterviewTranscript(draft.fields, interview.id);
      return [
        `### 访谈记录：${interview.code}`, `记录 ID：${interview.id}；${isAidtInterviewArchived(draft.fields, interview.id) ? "已归档，保留历史" : isAidtInterviewConfirmed(draft.fields, interview.id) ? "发现卡已由学生核对，不代表研究有效性已验证" : "发现卡尚待核对"}`,
        `研究主题来源：${interview.topicRevision ? `第 1 步 V${interview.topicRevision}` : "未绑定已保存版本"}${interview.problemEntityId ? `；问题 ${interview.problemEntityId}` : ""}`,
        `研究主题：${value(interview.topic)}`, `想了解什么：${value(interview.goal)}`,
        `学生提纲原稿：${value(interview.original)}`, `学生采纳清单：${value(interview.adopted)}`,
        `提纲状态：${interview.guideConfirmed ? "学生已核对清单；导出与采访是否完成须另查回执" : "草稿，尚未确认"}`,
        `学生的解释：${value(draft.fields[`interviewInterpretation:${interview.id}`])}`,
        ...(transcript ? [`校对摘录（${transcript.checked ? "学生标记已校对" : "待校对"}）：${value(transcript.text)}`, `摘录定位：${value(transcript.locator)}`] : ["校对摘录：尚未记录。"]),
        ...readAidtInterviewMaterials(draft.fields, interview.id).map(item => `所关联原件（用途和访问权限待核对）：${aidtResearchMaterialLabel(item.reference)}`), "",
      ];
    }), ...unreadable(draft, "interviewRecord:", interviews.length, "访谈记录")];
  }
  if (stage === 3) {
    const { personas, hmws, surprises } = readAidtDefinition(draft.fields), selected = readAidtDefinitionSelection(draft.fields);
    return [
      ...surprises.flatMap(record => [`### 意外发现记录：${value(record.observation)}`, `记录 ID：${record.id}；${state(record)}`,
        `原先想法：${value(record.priorBelief)}`, `学生解释：${value(record.interpretation)}`, `仍待核实：${value(record.unknowns)}`, `发现卡引用：${record.cardIds.join("、") || "尚缺引用"}`, ""]),
      ...personas.flatMap(record => [`### 用户画像记录：${value(record.name)}`, `记录 ID：${record.id}；${state(record)}`,
        `用户情境：${value(record.situation)}`, `可观察的行为：${value(record.behavior)}`, `需求：${value(record.need)}`, `反例、适用范围或仍未知：${value(record.limits)}`, `发现卡引用：${record.cardIds.join("、") || "尚缺引用"}`, ""]),
      ...hmws.flatMap(record => [`### HMW 记录：${value(record.text)}`, `记录 ID：${record.id}；${state(record)}${selected?.id === record.id ? "；本轮选用" : ""}`,
        `选择理由或待核实：${value(record.rationale)}`, `画像引用：${record.personaIds.join("、") || "尚缺引用"}`, `发现卡引用：${record.cardIds.join("、") || "尚缺引用"}`, ""]),
    ];
  }
  if (stage === 4) {
    const hmw = readAidtIdeaHmwSource(draft), sheets = readAidtIdeaSheetIds(draft), chosen = readAidtIdeaHandoffIds(draft);
    return [
      ...readAidtBrainstorms(draft.fields).map(session => `${aidtBrainstormTitle(session)}（${session.id}）：${AIDT_BRAINSTORM_METHODS[session.method]} · ${session.candidates.length} 个候选；HMW ${session.source.id} · 第 3 步 V${session.source.revision}：${session.source.text}`),
      ...(hmw ? [`本轮 HMW 来源：第 3 步 V${hmw.revision}；${hmw.id}`, `本轮 HMW：${hmw.text}`] : []),
      ...(sheets.length ? [`描述单记录：${sheets.join("、")}；完整性、学生确认及实际 PDF 请核对原回执。`] : []),
      ...(chosen.length ? [`进入原型的学生选择（非投票统计）：${chosen.map(id => draft.ideas.find(idea => idea.id === id)?.title || `引用 ${id} 待核对`).join("、")}`] : []),
    ];
  }
  if (stage === 5) {
    const keys = Object.keys(draft.fields).filter(key => key.startsWith("prototypeEntity:"));
    const selected = readAidtConfirmedPrototypeHandoff(draft);
    let parsed = 0;
    const lines = keys.flatMap(key => {
      const id = key.slice("prototypeEntity:".length), prototype = readAidtPrototypeEntityDraft(draft, id);
      if (!prototype) return [];
      parsed++;
      const reference = readAidtPrototypeReference(prototype), selection = readAidtPrototypeInputSelection(prototype);
      return [
        `### 原型记录：${reference?.designName || id}`, `记录 ID：${id}；${selected?.id === id ? "本轮已确认交接记录；原型仍需真实测试" : isAidtPrototypeHandoffConfirmed(prototype) ? "已确认候选，未据此自动选择当前交接" : "草稿或已修改，尚未确认交接"}`,
        ...fields(prototype, definitions), ...formatAidtVerificationMarkdown(prototype),
        ...(selection ? [`点子来源：第 4 步 V${selection.revision}；${selection.ideaIds.join("、")}`] : ["点子来源：尚缺已保存版本引用。"]), "",
      ];
    });
    return [...lines, ...unreadable(draft, "prototypeEntity:", parsed, "原型记录")];
  }
  if (stage === 6) {
    const groups = readAidtTestGroups(draft.fields);
    return [...groups.flatMap(group => [
      `### 测试记录：${group.name.trim() || "未命名测试"}`, `记录 ID：${group.id}；${group.archived ? "已归档，保留历史" : "学生记录，是否实际开展与证据效力须核对"}`,
      `被测原型来源：第 5 步 V${group.stage5Revision}；Design ${group.designId}；版本 ${group.versionId}`,
      `方法：${group.method === "survey" ? "问卷" : "访谈"}`, `测试对象代号：${value(group.participant)}`, `测试情境：${value(group.situation)}`, `测试任务：${value(group.task)}`,
      `实际说法（学生记录）：${value(group.said)}`, `实际行为（学生记录）：${value(group.did)}`, `学生解释：${value(group.interpretation)}`, `学生反思：${value(group.reflection)}`,
      `材料定位：${value(group.sourceLocation)}`, ...(group.source ? [`原生来源引用：${group.source.kind} ${group.source.id}（当前访问及内容待核对）`] : ["原生测试来源：尚未关联，不补造真实反馈。"]),
      ...(group.material ? [`关联测试原件（待核对）：${aidtResearchMaterialLabel(group.material)}`] : []),
      `反馈处理：${group.decision === "adopted" ? "学生选择采纳" : group.decision === "declined" ? "学生选择暂不采纳" : "待学生选择"}；${value(group.decisionReason)}`, "",
    ]), ...unreadable(draft, "testGroup:", groups.length, "测试记录")];
  }
  return [];
}
