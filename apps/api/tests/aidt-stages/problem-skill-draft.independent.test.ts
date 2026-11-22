import { expect, it } from 'vitest';
import { projectProblemSkillDraft } from '../../src/application/aidt-stages/problem-skill-draft';
const makeDraft = (problem: Record<string, string>) => ({ fields: { 'problemDraft:p': JSON.stringify(problem), untouched: '合成隔离字段' }, ideas: [], selectedIdeaId: '' });
const read = (value: { fields: Record<string, string> }) => JSON.parse(value.fields['problemDraft:p']!) as Record<string, string>;
it('does not turn a teaching quote into the original when the student has not chosen', () => {
 const before = makeDraft({ initial: '你好' });
 const after = projectProblemSkillDraft(before, 'p', { user: '上次引导师的追问（仅供对照）：\n想了解校园排队体验。\n学生的回答：\n我们还没选定。', assistant: '### 原始命题（逐字保留）\n想了解校园排队体验。', messageId: 'independent-quote' });
 expect(read(after ?? before).initial).not.toBe('想了解校园排队体验。');
});
it.each(['我们还没选方向，也还没重写，请先讨论。', '方向还没定，先不要重写命题。'])('does not overwrite selected direction, rewrite or evidence source when student says %s', user => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemDirections: JSON.stringify([{ id: 'direction-a', title: 'A', source: 'group' }]), problemSources: '["observation"]', sourceDetails: '合成说明，仅测试投影守卫', whyWorthStudying: '合成教学练习' });
 const after = projectProblemSkillDraft(before, 'p', { user, assistant: '### 本组选择的研究方向\nA\n\n### 学生重写命题（逐字保留）\nAI自行写的问题\n\n### 来源类型\n我们的猜测', messageId: 'independent-defer' });
 const fields = read(after ?? before);
 expect.soft(fields.rewrittenTheme).toBeUndefined();
 expect.soft(fields.problemDirectionId).toBeUndefined();
 expect.soft(fields.problemSources).toBe('["observation"]');
 expect.soft(fields.sourceDetails).toBe('合成说明，仅测试投影守卫');
 expect((after ?? before).fields.untouched).toBe('合成隔离字段');
});
it('keeps a short original and an independently verified initial through a quoted review', () => {
 const before = makeDraft({ initial: '你好' });
 const short = projectProblemSkillDraft(before, 'p', { user: '校园排队', assistant: '### 原始命题（逐字保留）\n校园排队', messageId: 'independent-short' });
 expect(read(short!).initial).toBe('校园排队');
 const verified = projectProblemSkillDraft(before, 'p', { user: '上次引导师的追问（仅供对照）：\n请先解释选题价值。\n学生的回答：\n暂未选定新的方向。', assistant: '### 原始命题（逐字保留）\n如何理解校园排队？', messageId: 'independent-verified', verifiedInitial: '如何理解校园排队？' });
 expect(read(verified!).initial).toBe('如何理解校园排队？');
});
it('preserves the existing explicit short selection and a student-authored rewrite', () => {
 const before = makeDraft({ initial: '商场照明', problemDirections: JSON.stringify([{ id: 'old', source: 'group', title: '夜间照明' }]) });
 const chosen = projectProblemSkillDraft(before, 'p', { user: '选夜间照明', assistant: '### 本轮选定方向\n夜间照明', messageId: 'independent-selection' });
 expect(read(chosen!)).toMatchObject({ initial: '商场照明', problemDirectionId: 'old', focus: '夜间照明' });
 const revised = projectProblemSkillDraft(chosen!, 'p', { user: '学生重写命题：如何理解学生夜间看不清路口的经历？', assistant: '### 学生重写命题（逐字保留）\n如何理解学生夜间看不清路口的经历？', messageId: 'independent-rewrite' });
 expect(read(revised!).rewrittenTheme).toBe('如何理解学生夜间看不清路口的经历？');
});
it('an explicit selection does not allow an assistant rewrite when the student defers rewriting', () => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemDirections: JSON.stringify([{ id: 'direction-a', title: 'A', source: 'group' }]), problemSources: '["observation"]', sourceDetails: '合成说明，仅测试投影守卫' });
 const after = projectProblemSkillDraft(before, 'p', { user: '本组选择的研究方向：A\n但我们暂时不重写命题，先讨论。', assistant: '### 本组选择的研究方向\nA\n\n### 学生重写命题（逐字保留）\nAI自行写的问题\n\n### 来源类型\n我们的猜测', messageId: 'independent-mixed' });
 const fields = read(after ?? before);
 expect(fields.problemDirectionId).toBe('direction-a');
 expect.soft(fields.rewrittenTheme).toBeUndefined();
 expect.soft(fields.problemSources).toBe('["observation"]');
 expect.soft(fields.sourceDetails).toBe('合成说明，仅测试投影守卫');
});
it('does not treat a comparison request as a student selection, rewrite or source declaration', () => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemDirections: JSON.stringify([{ id: 'direction-a', title: 'A', source: 'group' }]), problemSources: '["observation"]', sourceDetails: '学生原有合成来源说明' });
 const after = projectProblemSkillDraft(before, 'p', { user: '请先解释两个方向有什么区别。', assistant: '### 本组选择的研究方向\nA\n\n### 学生重写命题（逐字保留）\nAI自行写的问题\n\n### 来源类型\n我们的猜测\n\n### 来源说明\nAI补造来源', messageId: 'independent-comparison' });
 const fields = read(after ?? before);
 expect.soft(fields.problemDirectionId).toBeUndefined();
 expect.soft(fields.rewrittenTheme).toBeUndefined();
 expect.soft(fields.problemSources).toBe('["observation"]');
 expect.soft(fields.sourceDetails).toBe('学生原有合成来源说明');
});
it('keeps a real student hypothesis when another direction is deferred', () => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemDirections: JSON.stringify([{ id: 'direction-a', title: 'A', source: 'group' }]), problemSources: '["observation"]', sourceDetails: '旧合成来源说明' });
 const after = projectProblemSkillDraft(before, 'p', { user: '这些行为目前只是我们提出的假设。\n本组选择的研究方向：A\n学生重写命题：如何理解校园排队？\n我们暂不选择第二个方向。', assistant: '### 本组选择的研究方向\nA\n\n### 学生重写命题（逐字保留）\n如何理解校园排队？\n\n### 来源类型\n我们的猜测\n\n### 来源说明\n这些行为目前只是我们提出的假设。', messageId: 'independent-real-hypothesis' });
 expect(read(after!)).toMatchObject({ problemDirectionId: 'direction-a', rewrittenTheme: '如何理解校园排队？', problemSources: '["guess"]', sourceDetails: '这些行为目前只是我们提出的假设。' });
});
it('retains explicitly stated observation provenance while postponing a rewrite', () => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemSources: '["guess"]', sourceDetails: '原来的合成猜测' });
 const after = projectProblemSkillDraft(before, 'p', { user: '来源类型：亲自观察\n来源说明：我们看到两位合成同学在队尾停留。\n我们先不要重写命题。', assistant: '### 来源类型\n亲自观察\n\n### 来源说明\n我们看到两位合成同学在队尾停留。\n\n### 学生重写命题（逐字保留）\nAI自行写的问题', messageId: 'independent-observation-defer' });
 const fields = read(after ?? before);
 expect(fields).toMatchObject({ problemSources: '["observation"]', sourceDetails: '我们看到两位合成同学在队尾停留。' });
 expect(fields.rewrittenTheme).toBeUndefined();
});
it.each(['暂不重写命题，先比较方向。', '未定', '暂无'])('does not save a deferred rewrite placeholder: %s', rewritten => {
 const before = makeDraft({ initial: '如何理解校园排队体验？', problemDirections: JSON.stringify([{ id: 'direction-a', title: 'A', source: 'group' }]), problemDirectionId: 'direction-a', problemSources: '["guess"]', sourceDetails: '合成来源说明', whyWorthStudying: '合成教学练习' });
 const after = projectProblemSkillDraft(before, 'p', { user: '学生重写命题：' + rewritten, assistant: '### 学生重写命题（逐字保留）\n' + rewritten, messageId: 'independent-placeholder' });
 expect(read(after ?? before).rewrittenTheme).toBeUndefined();
});
