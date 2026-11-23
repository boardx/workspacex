import { describe, expect, it } from 'vitest';
import { projectInterviewSkillDraft, readInterviewChatDraft } from '../../src/application/aidt-stages/interview-skill-draft';
import fixture from './fixtures/aidt-u01-plain-draft-450752.json';
import eightFixtures from './fixtures/aidt-eight-plain-drafts-450752.json';
type Draft = Parameters<typeof projectInterviewSkillDraft>[0];
const entity = fixture.turns[0]!.entityId, other = '22222222-2222-4222-8222-222222222222';
const makeRecord = (id = entity, code = 'U01') => ({ id, version: 1, code, original: '', adopted: '', goal: '', guideConfirmed: false, consent: null });
function initial(own = makeRecord()): Draft { return { fields: { ['interviewRecord:' + entity]: JSON.stringify(own), ['interviewRecord:' + other]: JSON.stringify({ ...makeRecord(other, 'U02'), original: 'U02 原稿', adopted: 'U02 清单' }) }, ideas: [], selectedIdeaId: '' }; }
function record(draft: Draft) { return JSON.parse(draft.fields['interviewRecord:' + entity]!) as ReturnType<typeof makeRecord> & { draftTurnId?: string }; }
function project(draft: Draft, assistant: string, user = fixture.turns[1]!.prompt, messageId = 'synthetic-second-turn') { return projectInterviewSkillDraft(draft, entity, { projectId: fixture.turns[0]!.projectId, user, assistant, messageId }); }
function first() { const row = fixture.turns[0]!, draft = initial(), projected = project(draft, row.assistantText, row.prompt, row.assistantMessageId); expect(projected).not.toBeNull(); if (!projected) throw new Error('FIRST_STUDENT_DRAFT_MISSING'); return projected; }
const secondText = fixture.turns[1]!.assistantText;
function expectProtected(assistant: string) { const before = first(), next = project(before, assistant); const result = record(next ?? before); expect(result.adopted).toBe(''); expect(result.guideConfirmed).toBe(false); expect((next ?? before).fields['interviewRecord:' + other]).toBe(before.fields['interviewRecord:' + other]); }
describe('S2 actual ordinary prose question draft projection', () => {
  it('saves the real student opening first, while first clarifying reply is not a question list', () => { const draft = first(), own = record(draft); expect(own.original).toBe(fixture.turns[0]!.prompt); expect(own.adopted).toBe(''); expect(own.guideConfirmed).toBe(false); expect(readInterviewChatDraft(fixture.turns[0]!.assistantText)).toBeNull(); });
  it('projects only four actual U01 proposed questions and preserves original and neighbor without confirming', () => {
    const before = first(), row = fixture.turns[1]!, after = project(before, row.assistantText, row.prompt, row.assistantMessageId); expect(after).not.toBeNull(); if (!after) throw new Error('SECOND_QUESTION_DRAFT_MISSING'); const own = record(after);
    expect(own.adopted.split('\n')).toEqual(fixture.expectedQuestions); expect(own.original).toBe(fixture.turns[0]!.prompt); expect(own.guideConfirmed).toBe(false); expect(own.draftTurnId).toBe(row.assistantMessageId); expect(own.consent).toBeNull(); expect(after.discoveryCards).toBeUndefined(); expect(after.fields['interviewRecord:' + other]).toBe(before.fields['interviewRecord:' + other]); expect(after.fields.roundCompletion).toBeUndefined();
  });
  it('does not include preceding numbered clarifications, following reasons or closing questions', () => { const parsed = readInterviewChatDraft(secondText, 'U01'); expect(parsed?.questions).toEqual(fixture.expectedQuestions); expect(parsed?.questions?.some(value => value.includes('第一题锚定') || value.includes('是想了解') || value.includes('你觉得这四个问题'))).toBe(false); });
  it('does not manufacture the student opening from an AI draft alone', () => { const before = initial(), after = project(before, secondText, '请继续，不要替我们填写。'); expect(record(after ?? before).original).toBe(''); expect(record(after ?? before).adopted).toBe(''); });
  it('rejects a proposed list explicitly assigned to another participant', () => { expectProtected(secondText.replaceAll('U01', 'U02')); });
  it('rejects ordinary feedback and clarifying questions without an explicit proposed-list introduction', () => { expectProtected('你提出的方向不错，但先确认两点：\n1. 你说的是哪个窗口？\n2. 当时有排队吗？\n请先回答，再讨论清单。'); });
  it('does not project unrelated bullet suggestions', () => { expectProtected('建议你们小组接下来分工：\n- 小王负责录音。\n- 小李负责记录。\n- 课后再决定问题。'); });
  it.each([
    '老师说：\n' + secondText,
    'AI说：\n' + secondText,
    '下面只是引用老师的例子，不是本组采纳的清单：\n' + secondText,
    '下面只是AI示例，不是本组清单：\n' + secondText,
    '```text\n' + secondText + '\n```',
    secondText.split('\n').map(line => '> ' + line).join('\n'),
  ])('does not adopt a teacher/AI/code/blockquote example', assistant => { expectProtected(assistant); });
  it('preserves a student-confirmed existing question list', () => { const before = initial({ ...makeRecord(), original: '学生先写的原稿', adopted: '已确认的问题清单？', guideConfirmed: true }); const after = project(before, secondText); expect(record(after ?? before).adopted).toBe('已确认的问题清单？'); expect(record(after ?? before).guideConfirmed).toBe(true); });
  it('preserves existing unconfirmed questions when the next reply only clarifies', () => { const before = initial({ ...makeRecord(), original: '学生先写的原稿', adopted: '已有待审问题？' }); const after = project(before, '你想问的是窗口位置，还是选择动机？请先澄清。'); expect(record(after ?? before).adopted).toBe('已有待审问题？'); });
  it('does not project into an archived participant', () => { const before = first(); before.fields['interviewArchived:' + entity] = 'true'; expect(project(before, secondText)).toBeNull(); });
  it('does not write a second copy for the same completed turn', () => { const before = first(), after = project(before, secondText, fixture.turns[1]!.prompt, 'synthetic-repeat'); if (after) expect(project(after, secondText, fixture.turns[1]!.prompt, 'synthetic-repeat')).toBeNull(); else expect(after).not.toBeNull(); });
  it('does not adopt a generic draft explicitly assigned to another participant', () => {
    expectProtected('这是给 U02 的问题清单草稿。\n建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
  });

  it.each(Object.entries(eightFixtures))('projects only the actual proposed list, or retains a clarifying reply for %s', (code, sample) => {
    const id = sample.turns[0]!.entityId;
    let draft: Draft = { fields: { ['interviewRecord:' + id]: JSON.stringify(makeRecord(id, code)), unrelated: 'neighbor unchanged' }, ideas: [], selectedIdeaId: '' };
    for (const row of sample.turns) {
      const next = projectInterviewSkillDraft(draft, id, { projectId: row.projectId, user: row.prompt, assistant: row.assistantText, messageId: row.assistantMessageId });
      if (next) draft = next;
    }
    const own = JSON.parse(draft.fields['interviewRecord:' + id]!) as ReturnType<typeof makeRecord>;
    expect(own.original).toBe(sample.turns[0]!.prompt);
    expect(own.adopted ? own.adopted.split('\n') : []).toEqual(sample.expectedQuestions);
    expect(own.guideConfirmed).toBe(false); expect(own.consent).toBeNull(); expect(draft.fields.unrelated).toBe('neighbor unchanged'); expect(draft.discoveryCards).toBeUndefined();
  });

  it('does not adopt an explicit other-recipient proposal whose introduction is on the same line', () => {
    expectProtected('这是给 U02 的问题清单草稿。建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
  });
  it('keeps the current recipient and question literal under a generic draft introduction', () => {
    const before = first(), after = project(before, '这是给 U01 的问题清单草稿。\n建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe('请描述最近一次选择饮品时发生了什么？'); expect(record(after!).guideConfirmed).toBe(false);
  });
  it.each(['P.1', 'guest-A'])('uses the actual participant code rather than a hard-coded U sequence: %s', code => {
    const before = initial({ ...makeRecord(), code, original: '学生先拟的原始问题？' });
    const after = project(before, '这是给 ' + code + ' 的访谈提纲草稿。\n建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe('请描述最近一次选择饮品时发生了什么？'); expect(record(after!).original).toBe('学生先拟的原始问题？');
  });
  it('does not treat a regex-similar different code as the same participant', () => {
    const before = initial({ ...makeRecord(), code: 'P.1', original: '学生先拟的原始问题？' });
    const after = project(before, '这是给 Px1 的访谈提纲草稿。\n建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
    expect(record(after ?? before).adopted).toBe('');
  });

  it.each([
    '下面是 U02 的问题清单草稿。建议改写（供你们讨论）：',
    '下面是 U02 的问题清单草稿。\n建议改写（供你们讨论）：',
    'U02的问题清单草稿：\n建议改写（供你们讨论）：',
    'U02的问题清单草稿：建议改写（供你们讨论）：',
  ])('does not fill U01 from a separately identified U02 proposal: %s', introduction => {
    expectProtected(introduction + '\n1. 你最近一次买饮品是什么时候？');
  });
  it('keeps another participant code mentioned inside the actual interview question as content', () => {
    const before = first(), question = '如果你和U02同学一起买饮品，当时怎样商量去哪个窗口？';
    const after = project(before, '建议改写（供你们讨论）：\n1. ' + question);
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe(question);
  });
  it('accepts an explicitly identified current recipient with a below-is introduction', () => {
    const before = first(), question = '你最近一次买饮品是什么时候？';
    const after = project(before, '下面是 U01 的问题清单草稿。建议改写（供你们讨论）：\n1. ' + question);
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe(question);
  });

  it.each(['老师', '教师'])('does not turn an explicitly attributed teacher proposal into the current draft: %s', speaker => {
    expectProtected(speaker + '：\n建议改写（供你们讨论）：\n1. 请描述最近一次选择饮品时发生了什么？');
  });
  it('allows an AI author label on a normal candidate when it is not identified as quoted comparison material', () => {
    const before = first(), question = '请描述最近一次选择饮品时发生了什么？';
    const after = project(before, 'AI：\n建议改写（供你们讨论）：\n1. ' + question);
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe(question); expect(record(after!).guideConfirmed).toBe(false);
  });
  it('does not globally prohibit a real question whose content mentions a teacher or AI', () => {
    const before = first(), question = '你听到老师或AI的建议以后，怎样作出自己的选择？';
    const after = project(before, '建议改写（供你们讨论）：\n1. ' + question);
    expect(after).not.toBeNull(); expect(record(after!).adopted).toBe(question);
  });

});
