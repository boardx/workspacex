import { describe, expect, it, vi } from 'vitest';
import { SharedStage } from '@repo/contracts/aidt-stages';
import type { TenantSession } from '../../src/application/ports/database.port';
import type { AidtStagesService } from '../../src/application/aidt-stages/service';
import type { AidtContextActor } from '../../src/application/aidt-run-context/ports';
import type { PermissionDecision } from '../../src/domain/identity/permission-decision';
import { toOrgId } from '../../src/domain/org-id';
import { aidtEntityThreadId } from '../../src/application/aidt-stages/entity-thread';
import { projectProblemSkillDraft } from '../../src/application/aidt-stages/problem-skill-draft';
import { projectSavedSkillOutput, recoverProblemFraming } from '../../src/infrastructure/aidt-run-context/pg-skill-output';

// Synthetic ports exercise the real projection and history callers, without a database or model.
const topic = '想了解校园排队体验。';
const quoteOnly = `下面只是引用老师的示例，不是我们的研究决定：\n> ${topic}\n我们尚未选择研究命题。`;
const answer = (value = topic) => `**原始命题（逐字保留）**\n> ${value}`;
const draft = (initial?: string) => ({ fields: { 'problemDraft:p': JSON.stringify(initial ? { initial } : {}), untouched: '合成隔离字段' }, ideas: [], selectedIdeaId: '' });
const read = (value: { fields: Record<string, string> }) => JSON.parse(value.fields['problemDraft:p']!) as Record<string, string>;

describe('S1 teacher-only quotes cannot supply a student original', () => {
  it.each([undefined, '你好'])('rejects the teacher topic with prior original %s', initial => {
    const before = draft(initial);
    const after = projectProblemSkillDraft(before, 'p', { user: quoteOnly, assistant: answer(), messageId: 'qa-quote-only' });
    expect(read(after ?? before).initial).not.toBe(topic);
    expect((after ?? before).fields.untouched).toBe('合成隔离字段');
    expect(read(after ?? before).roundCompletion).toBeUndefined();
  });
  it('rejects an original-field label inside the quoted teacher material', () => {
    const before = draft();
    const after = projectProblemSkillDraft(before, 'p', {
      user: `老师举例，不是本组决定：\n> 原始命题：${topic}\n我们尚未选择。`, assistant: answer(), messageId: 'qa-quoted-label',
    });
    expect(read(after ?? before).initial).not.toBe(topic);
  });
  it.each(['想了解学生等待时间 > 10分钟时是否继续排队。', '> 我们想研究有限午休里学生如何决定是否排队。'])('preserves the student literal original %s', initial => {
    const after = projectProblemSkillDraft(draft(), 'p', { user: '原始命题：' + initial, assistant: answer(initial), messageId: 'qa-literal' });
    expect(after).not.toBeNull();
    expect(read(after!).initial).toBe(initial);
  });
  it('preserves an original given as a bare literal greater-than line', () => {
    const initial = '> 学生在哪里停下？';
    const after = projectProblemSkillDraft(draft(), 'p', { user: initial, assistant: answer(initial), messageId: 'qa-bare-literal' });
    expect(read(after!).initial).toBe(initial);
  });
  it('does not reclassify the student original when the following block introduces a teacher example', () => {
    const initial = '> 学生在哪里停下？';
    const after = projectProblemSkillDraft(draft(), 'p', {
      user: `原始命题：\n${initial}\n\n下面仅引用老师的另一个示例：\n> ${topic}`,
      assistant: answer(initial), messageId: 'qa-student-before-teacher',
    });
    expect(after).not.toBeNull();
    expect(read(after!).initial).toBe(initial);
  });
  it('keeps the separate student original after a teacher comparison block', () => {
    const initial = '> 学生在哪里停下？';
    const after = projectProblemSkillDraft(draft(), 'p', {
      user: `下面仅引用老师的示例：\n> ${topic}\n\n原始命题：\n${initial}`,
      assistant: answer(initial), messageId: 'qa-student-after-teacher',
    });
    expect(after).not.toBeNull();
    expect(read(after!).initial).toBe(initial);
  });
  it('accepts a topic the student explicitly states outside the quoted example', () => {
    const after = projectProblemSkillDraft(draft(), 'p', {
      user: quoteOnly + '\n讨论之后，我们现在决定自己的原始命题。\n原始命题：' + topic,
      assistant: answer(), messageId: 'qa-explicit-student-adoption',
    });
    expect(read(after!).initial).toBe(topic);
    expect(read(after!).roundCompletion).toBeUndefined();
  });
  it('preserves the natural student statement fallback when the assistant only asks a question', () => {
    const initial = '我们想了解午休时间有限时学生如何选择饮品。';
    const after = projectProblemSkillDraft(draft(), 'p', { user: initial, assistant: '你们为什么想研究这件事？', messageId: 'qa-natural-initial' });
    expect(read(after!).initial).toBe(initial);
  });
});

const entityId = 'qa-teacher-quote';
const scope = { orgId: toOrgId('org-teacher-quote-qa'), projectId: 'qa-teacher-project', userId: 'qa-student' };
const actor: AidtContextActor = { ...scope, threadId: aidtEntityThreadId(scope, 1, entityId, 'stage') };
const stage = SharedStage.parse({ projectId: actor.projectId, stageId: 1, revision: 1,
  content: { schemaVersion: 1, draft: { fields: {
    ['problemEntity:' + entityId]: JSON.stringify({ id: entityId, title: '合成归因测试' }),
    ['problemDraft:' + entityId]: '{}',
  }, ideas: [], selectedIdeaId: '' } }, sourceStageRevisions: [], updatedBy: actor.userId, updatedAt: '2026-11-22T10:00:00.000Z' });
const decision: PermissionDecision = { allowed: true, decisionId: 'qa-teacher-decision', reasonCode: null,
  orgLayer: { role: 'consultant', teamId: null, passed: true }, projectLayer: { role: 'member', groupId: null, passed: true },
  scopeLayer: { scope: 'org-wide', passed: true } };
const inputAt = new Date('2026-11-22T09:59:00.000Z');
function setup(user: string, history: { body: string }[], initial = topic) {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ run_id: 'qa-teacher-run', message_id: 'qa-teacher-reply', user_text: user,
    assistant_text: answer(initial), source_revision: 1, requested_by: actor.userId, input_at: inputAt }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: history });
  const save = vi.fn().mockResolvedValue({});
  const stages = { get: vi.fn().mockResolvedValue({ stage }), save, getRevision: vi.fn() } as unknown as AidtStagesService;
  return { query, save, stages, session: { query } as TenantSession };
}
describe('S1 teacher-only attribution through real PostgreSQL callers with synthetic ports', () => {
  it('does not save a teacher-only quote in the current human message', async () => {
    const f = setup(quoteOnly, []);
    expect(await projectSavedSkillOutput(f.session, f.stages, actor, decision, 1, entityId)).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
  });
  it('does not promote a teacher-only quote from earlier human-message history', async () => {
    const f = setup('先讨论，尚未选定。', [{ body: quoteOnly }]);
    expect(await projectSavedSkillOutput(f.session, f.stages, actor, decision, 1, entityId)).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.query.mock.calls[2]![1]).toEqual([actor.orgId, actor.threadId, inputAt, topic]);
  });
  it('does not recover a teacher-only quote as a frozen student original', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ body: answer() }] })
      .mockResolvedValueOnce({ rows: [{ original: topic, body: quoteOnly }] });
    expect(await recoverProblemFraming({ query } as TenantSession, actor, stage, entityId)).toBeUndefined();
    expect(query.mock.calls[1]![1]).toEqual([actor.orgId, actor.threadId, [topic], stage.updatedAt]);
  });
  it.each(['想了解学生等待时间 > 10分钟时是否继续排队。', '> 我们想研究有限午休里学生如何决定是否排队。', '> 学生在哪里停下？'])('keeps earlier student original and pinned recovery exact: %s', async initial => {
      const body = initial.startsWith('> 学生在哪里') ? initial : '原始命题：' + initial;
      const f = setup('继续讨论。', [{ body }], initial);
      expect(await projectSavedSkillOutput(f.session, f.stages, actor, decision, 1, entityId)).toBe(true);
      const saved = f.save.mock.calls[0]![1];
      const fields = JSON.parse(saved.content.draft.fields['problemDraft:' + entityId]);
      expect(fields.initial).toBe(initial);
      expect(fields.roundCompletion).toBeUndefined();
      expect(fields.problemReflectionConfirmed).toBeUndefined();
      const query = vi.fn().mockResolvedValueOnce({ rows: [{ body: answer(initial) }] })
        .mockResolvedValueOnce({ rows: [{ original: initial, body }] });
      expect(await recoverProblemFraming({ query } as TenantSession, actor, stage, entityId)).toBe(initial);
  });
});
