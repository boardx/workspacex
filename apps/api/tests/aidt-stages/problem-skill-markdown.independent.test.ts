import { expect, it } from 'vitest';
import turns from '../fixtures/aidt-s1-live-markdown-45014881332.json';
import { problemSkillFields, projectProblemSkillDraft } from '../../src/application/aidt-stages/problem-skill-draft';

const base = { fields: { 'problemDraft:p': JSON.stringify({ initial: '你好' }) }, ideas: [], selectedIdeaId: '' };
const rewritten = /^学生重写命题：([^\r\n]+)/mu.exec(turns[1]!.user)![1]!;
it('projects the actual second synthetic reply without treating Markdown quotation as student wording', () => {
  const first = projectProblemSkillDraft(base, 'p', { ...turns[0]!, messageId: 'qa-first' })!;
  const revised = projectProblemSkillDraft(first, 'p', { ...turns[1]!, messageId: 'qa-second' })!;
  const fields = JSON.parse(revised.fields['problemDraft:p']!);
  expect(fields).toMatchObject({ initial: turns[0]!.user, rewrittenTheme: rewritten,
    focus: '午休后赶课学生在教学楼下饮品店的选择犹豫', problemSources: '["guess"]',
    sourceDetails: '这些行为目前只是我们提出的假设。', draftTurnId: 'qa-second' });
  expect(JSON.parse(fields.problemDirections)).toContainEqual({ id: fields.problemDirectionId, title: fields.focus, source: 'group' });
  expect(fields.roundCompletion).toBeUndefined();
  expect(fields.problemReflectionConfirmed).toBeUndefined();
});
it.each(['> ', '>> ', '  > > '])('parses display quotation %s while preserving a mathematical comparison inside the question', prefix => {
  const question = '如何理解等待时间 > 20 分钟时学生的选择？';
  expect(problemSkillFields(`${prefix}**学生重写命题（逐字保留）**\n${prefix}${question}`).rewrittenTheme).toBe(question);
  const first = { ...base, fields: { 'problemDraft:p': JSON.stringify({ initial: '校园排队' }) } };
  const next = projectProblemSkillDraft(first, 'p', { user: '学生重写命题：' + question,
    assistant: '**学生重写命题（逐字保留）**\n' + prefix + question, messageId: 'qa-display-quote' });
  expect(JSON.parse(next!.fields['problemDraft:p']!).rewrittenTheme).toBe(question);
});
it('does not admit a substituted assistant question just because it is rendered as a quote', () => {
  const first = projectProblemSkillDraft(base, 'p', { ...turns[0]!, messageId: 'qa-first' })!;
  const changed = turns[1]!.assistant.replace(rewritten, '如何证明所有学生都愿意使用推荐应用？');
  const revised = projectProblemSkillDraft(first, 'p', { user: turns[1]!.user, assistant: changed, messageId: 'qa-substituted' });
  expect(JSON.parse((revised ?? first).fields['problemDraft:p']!).rewrittenTheme).toBeUndefined();
});
it('does not adopt a quoted teacher source example as the student group source', () => {
  const first = { ...base, fields: { 'problemDraft:p': JSON.stringify({ initial: '校园排队' }) } };
  const next = projectProblemSkillDraft(first, 'p', {
    user: '先看老师给的例子：\n> 来源类型：我们的猜测\n> 来源说明：这只是老师示例，不是我们小组的来源。\n\n我们尚未标注来源。',
    assistant: '### 来源类型\n我们的猜测\n\n### 来源说明\n这只是老师示例，不是我们小组的来源。', messageId: 'qa-quoted-teacher-source',
  });
  const fields = JSON.parse((next ?? first).fields['problemDraft:p']!);
  expect(fields.problemSources).toBeUndefined();
  expect(fields.sourceDetails).toBeUndefined();
});
