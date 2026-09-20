import { survey } from '@repo/contracts';
export function requiredTemplateQuestions(template: survey.SurveyReportTemplate): string[] {
  return [...new Set(template.sections.flatMap(section => section.blocks.flatMap(block => [
    ...block.questionIds, ...(block.groupByQuestionId ? [block.groupByQuestionId] : []),
  ])))];
}
/** A copied template owns new block identities and explicit destination bindings. */
export function remapReportTemplate(
  source: { questions: survey.SurveyWorkflowQuestion[]; template: survey.SurveyReportTemplate },
  destination: survey.SurveyWorkflowQuestion[],
  bindings: Record<string, string>,
): survey.SurveyReportTemplate {
  const required = requiredTemplateQuestions(source.template);
  const used = new Set<string>();
  for (const id of required) {
    const original = source.questions.find(q => q.id === id);
    const target = destination.find(q => q.id === bindings[id]);
    if (!original || !target) throw new Error('请为模板中的每个引用选择当前问卷题目。');
    if (original.type !== target.type) throw new Error('模板题目与当前问卷题型不一致，请重新选择。');
    if (used.has(target.id)) throw new Error('不同模板题目不能映射到同一题目。');
    used.add(target.id);
  }
  return survey.SurveyReportTemplateSchema.parse({
    ...structuredClone(source.template), id: crypto.randomUUID(),
    sections: source.template.sections.map(section => ({
      ...section, id: crypto.randomUUID(), blocks: section.blocks.map(block => ({
        ...block, id: crypto.randomUUID(),
        questionIds: block.questionIds.map(id => bindings[id]!),
        ...(block.groupByQuestionId ? {groupByQuestionId: bindings[block.groupByQuestionId]} : {}),
      })),
    })),
  });
}
