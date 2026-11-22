import { describe, expect, it } from 'vitest';
import { projectProblemSkillDraft } from '../../src/application/aidt-stages/problem-skill-draft';
import actualTurns from './fixtures/aidt-s1-live-headings-450692.json';

type Draft = Parameters<typeof projectProblemSkillDraft>[0];
const turns = () => structuredClone(actualTurns);
const studentField = (text: string, label: string) => new RegExp('^' + label + '[：:]([^\\r\\n]+)$', 'mu').exec(text)?.[1]?.trim();
function replay(rows = turns()) {
  const entity = rows[0]!.entityId;
  let draft: Draft = { fields: { ['problemEntity:' + entity]: JSON.stringify({ id: entity, title: '合成软件 QA', archived: false }), neighbor: 'untouched' }, ideas: [], selectedIdeaId: '' };
  for (const row of rows) {
    const next = projectProblemSkillDraft(draft, entity, { user: row.prompt, assistant: row.assistantText, messageId: row.assistantMessageId });
    expect(next).not.toBeNull();
    if (!next) throw new Error('SYNTHETIC_DRAFT_MISSING');
    draft = next;
  }
  const fields = JSON.parse(draft.fields['problemDraft:' + entity]!) as Record<string, string>;
  expect(fields.roundCompletion).toBeUndefined();
  expect(fields.problemReflectionConfirmed).toBeUndefined();
  expect(draft.fields.neighbor).toBe('untouched');
  return fields;
}
function projectSource(user: string) {
  const old = { initial: '如何理解校园购买选择？', problemSources: '["observation"]', sourceDetails: '先前学生自己的合成观察记录' };
  const before: Draft = { fields: { 'problemDraft:p': JSON.stringify(old) }, ideas: [], selectedIdeaId: '' };
  const next = projectProblemSkillDraft(before, 'p', { user, assistant: '**来源类型**\n猜测\n\n**来源描述**\nAI 自行提出的内容。', messageId: 'synthetic-current-turn' });
  return { fields: JSON.parse((next ?? before).fields['problemDraft:p']!) as Record<string, string>, old };
}
describe('actual synthetic 450692 heading and source scope regression', () => {
  it('retains literal original, selected direction and rewrite and recovers student provenance without confirming', () => {
    const rows = turns(), fields = replay(rows);
    expect(fields.initial).toBe(rows[0]!.prompt);
    expect(fields.focus).toBe(studentField(rows[1]!.prompt, '本组选择的研究方向'));
    expect(fields.rewrittenTheme).toBe(studentField(rows[1]!.prompt, '学生重写命题'));
    expect(fields.problemSources).toBe('["guess"]');
    expect(fields.sourceDetails).toBe('这是为验收设定的研究假设，尚没有真实观察、抱怨原话或访谈支持。');
    expect(rows[1]!.prompt).toContain(fields.sourceDetails);
    expect(fields.whyWorthStudying).toBeTruthy();
    expect(rows[1]!.prompt).toContain(fields.whyWorthStudying);
    expect(fields.sourceUncertainty).toBe('犹豫是否普遍、原因是什么、是否真的影响赶课。');
    const choices = JSON.parse(fields.problemDirections!) as Array<{ id: string; title: string; source: string }>;
    expect(choices).toContainEqual({ id: fields.problemDirectionId, title: fields.focus, source: 'group' });
  });
  it('retains literal greater-than direction through only Markdown and final-period presentation', () => {
    const rows = turns(), own = studentField(rows[1]!.prompt, '本组选择的研究方向')!;
    rows[1]!.prompt = rows[1]!.prompt.replace('本组选择的研究方向：' + own, '本组选择的研究方向：> ' + own);
    rows[1]!.assistantText = rows[1]!.assistantText.replace(own + '。', '> > ' + own + '。');
    expect(replay(rows).focus).toBe('> ' + own);
  });
  it.each(['午休赶课情境下学生购买新饮品时的排队', '闲暇情境下学生购买旧饮品时的犹豫'])('rejects a substantive assistant direction change: %s', changed => {
    const rows = turns(), own = studentField(rows[1]!.prompt, '本组选择的研究方向')!;
    rows[1]!.assistantText = rows[1]!.assistantText.replace(own + '。', changed + '。');
    const fields = replay(rows); expect(fields.focus).toBeUndefined(); expect(fields.problemDirections).toBeUndefined();
  });
  it('does not treat an AI heading as a student choice', () => {
    const rows = turns(); rows[1]!.prompt = rows[1]!.prompt.replace(/^本组选择的研究方向：.+$/mu, '本轮尚未选择研究方向。');
    expect(replay(rows).focus).toBeUndefined();
  });
  it.each([
    '下面仅引用老师的示例，不是本组来源：\n问题来源：猜测\n来源描述：老师示例说明。',
    '下面仅引用老师的示例，不是本组来源：\n> 问题来源：猜测\n> 来源描述：老师示例说明。',
    '请先比较，不要替我们确定来源。',
    '问题来源：猜测。来源描述：老师示例说明。以上是老师的示例，不是本组来源。',
    '问题来源：猜测。来源描述：本组合成想法。我们还没有确定选题来源。',
    '问题来源：猜测。我们还没有决定具体来源说明。',
    '来源描述：这是本组合成材料。我们还没有确定来源。',
  ])('does not replace existing provenance from comparison, withdrawal or an unpaired field: %s', user => {
    const { fields, old } = projectSource(user); expect(fields.problemSources).toBe(old.problemSources); expect(fields.sourceDetails).toBe(old.sourceDetails);
  });
  it('retains the actual student pair before a separate forward teacher example', () => {
    const own = '这是本组明确声明的合成来源。';
    const { fields } = projectSource('问题来源：猜测。来源描述：' + own + '\n下面仅引用老师不同例子：\n> 问题来源：亲自观察\n> 来源描述：老师的记录。');
    expect(fields.problemSources).toBe('["guess"]'); expect(fields.sourceDetails).toBe(own);
  });
  it('stops a same-paragraph student source at the next explicit field', () => {
    const { fields } = projectSource('针对老师关于来源的追问：问题来源：猜测。来源描述：本组尚未开展真实访谈。尚不确定：是否普遍。');
    expect(fields.problemSources).toBe('["guess"]'); expect(fields.sourceDetails).toBe('本组尚未开展真实访谈。');
  });
  it.each([
    'ai示例：问题来源：猜测。来源描述：排队太长影响选择。',
    '问题来源：猜测。来源描述：ai示例：排队太长影响选择。',
    'aI说：问题来源：猜测。来源描述：排队太长影响选择。',
    '问题来源：猜测。来源描述：AI示例：排队太长影响选择。',
    'AI说：问题来源：猜测。来源描述：排队太长影响选择。',
    '问题来源：猜测。来源描述：老师说：排队太长影响选择。',
    'AI示例：问题来源：猜测。来源描述：排队太长影响选择。',
    '复制AI回复：问题来源：猜测。来源描述：排队太长影响选择。',
    'AI示例：问题来源：猜测。来源描述：排队太长影响选择。\n\n我们尚未确定选题来源。',
    '以下是AI示例，不是本组来源：\n> 问题来源：猜测\n> 来源描述：排队太长影响选择。',
  ])('does not attribute explicit AI comparison material to the student: %s', user => {
    const { fields, old } = projectSource(user); expect(fields.problemSources).toBe(old.problemSources); expect(fields.sourceDetails).toBe(old.sourceDetails);
  });
  it('allows a real student observation whose actual content mentions AI', () => {
    const own = '我们在食堂看到同学用AI比较饮品。';
    const { fields } = projectSource('问题来源：亲自观察。来源描述：' + own);
    expect(fields.problemSources).toBe('["observation"]'); expect(fields.sourceDetails).toBe(own);
  });
  it('attributes an explicit own declaration after a blank separately from the prior AI example', () => {
    const own = '我们自己在食堂看到同学用AI比较饮品。';
    const { fields } = projectSource('AI示例：问题来源：猜测。来源描述：排队太长影响选择。\n\n本组来源是亲自观察：' + own);
    expect(fields.problemSources).toBe('["observation"]'); expect(fields.sourceDetails).toBe(own);
  });

  it('retains actual own observation content mentioning lowercase ai', () => {
    const own = '我们在食堂看到同学用ai比较饮品。';
    const { fields } = projectSource('来源是亲自观察：' + own);
    expect(fields.problemSources).toBe('["observation"]'); expect(fields.sourceDetails).toBe(own);
  });

});
