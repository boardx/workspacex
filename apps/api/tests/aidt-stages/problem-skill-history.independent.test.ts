import { describe, expect, it, vi } from 'vitest';
import { SharedStage } from '@repo/contracts/aidt-stages';
import type { TenantSession } from '../../src/application/ports/database.port';
import type { AidtStagesService } from '../../src/application/aidt-stages/service';
import type { AidtContextActor } from '../../src/application/aidt-run-context/ports';
import type { PermissionDecision } from '../../src/domain/identity/permission-decision';
import { toOrgId } from '../../src/domain/org-id';
import { aidtEntityThreadId } from '../../src/application/aidt-stages/entity-thread';
import { projectSavedSkillOutput, recoverProblemFraming } from '../../src/infrastructure/aidt-run-context/pg-skill-output';

// Port tests exercise the real projector/caller with synthetic query results, not PostgreSQL.
const entityId = 'qa-problem';
const original = '想了解校园排队体验。';
const quoted = `上次引导师的追问（仅供对照）：\n${original}\n学生的回答：\n我们还没选定。`;
const assistant = `### 原始命题（逐字保留）\n${original}`;
const scope = { orgId: toOrgId('org-independent-qa'), projectId: 'qa-project', userId: 'qa-member' };
const actor: AidtContextActor = { ...scope, threadId: aidtEntityThreadId(scope, 1, entityId, 'stage') };
const stage = SharedStage.parse({ projectId: actor.projectId, stageId: 1, revision: 1,
  content: { schemaVersion: 1, draft: { fields: {
    ['problemEntity:' + entityId]: JSON.stringify({ id: entityId, title: '合成隔离命题' }),
    ['problemDraft:' + entityId]: JSON.stringify({ initial: '你好' }),
  }, ideas: [], selectedIdeaId: '' } },
  sourceStageRevisions: [], updatedBy: actor.userId, updatedAt: '2026-11-22T10:00:00.000Z' });
const decision: PermissionDecision = { allowed: true, decisionId: 'qa-decision', reasonCode: null,
  orgLayer: { role: 'consultant', teamId: null, passed: true },
  projectLayer: { role: 'member', groupId: null, passed: true }, scopeLayer: { scope: 'org-wide', passed: true } };
const inputAt = new Date('2026-11-22T09:59:00.000Z');
function setup(userText: string, history: { body: string }[]) {
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ run_id: 'qa-run', message_id: 'qa-reply',
    user_text: userText, assistant_text: assistant, source_revision: 1, requested_by: actor.userId, input_at: inputAt }] })
    .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: history });
  const save = vi.fn().mockResolvedValue({});
  const stages = { get: vi.fn().mockResolvedValue({ stage }), save, getRevision: vi.fn() };
  return { query, save, stages: stages as unknown as AidtStagesService, session: { query } as TenantSession };
}
describe('S1 historical student attribution at the database port', () => {
  it('does not promote a teacher quote found in human-message history', async () => {
    const f = setup('还没有新方向，先讨论。', [{ body: quoted }]);
    expect(await projectSavedSkillOutput(f.session, f.stages, actor, decision, 1, entityId)).toBe(false);
    expect(f.save).not.toHaveBeenCalled();
    const [sql, params] = f.query.mock.calls[2]!;
    expect(sql).toMatch(/org_id=\$1 AND thread_id=\$2 AND author_kind='human'/);
    expect(sql).toContain('NOT raw_transcript');
    expect(sql).toContain("COALESCE(visibility_scope,'plenary')='plenary'");
    expect(sql).toContain('created_at <= $3');
    expect(sql).toContain('char_length(body) <= 100000');
    expect(sql).toContain('LIMIT 32');
    expect(params).toEqual([actor.orgId, actor.threadId, inputAt, original]);
  });
  it.each(['继续讨论。', quoted])('retains an actual earlier student framing when current input is %s', async user => {
    const f = setup(user, [{ body: `学生的回答：\n${original}` }]);
    expect(await projectSavedSkillOutput(f.session, f.stages, actor, decision, 1, entityId)).toBe(true);
    const saved = f.save.mock.calls[0]![1];
    const savedDraft = JSON.parse(saved.content.draft.fields['problemDraft:' + entityId]);
    expect(savedDraft.initial).toBe(original);
    expect(savedDraft.roundCompletion).toBeUndefined();
    expect(savedDraft.problemReflectionConfirmed).toBeUndefined();
    expect(saved).toMatchObject({ projectId: actor.projectId, stageId: 1, expectedRevision: 1, sourceStageRevisions: [] });
    expect(saved.content.draft.fields.problemConfirmed).toBeUndefined();
  });
  it('keeps a denied decision from saving or resolving history', async () => {
    const f = setup('继续讨论。', [{ body: original }]);
    expect(await projectSavedSkillOutput(f.session, f.stages, actor,
      { ...decision, allowed: false, reasonCode: 'NO_PROJECT_ROLE' }, 1, entityId)).toBe(false);
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.save).not.toHaveBeenCalled();
  });
  it('rejects a mismatched thread before querying or saving', async () => {
    const f = setup(original, []);
    expect(await projectSavedSkillOutput(f.session, f.stages, { ...actor, threadId: 'other-thread' }, decision, 1, entityId)).toBe(false);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
});
describe('S1 pinned framing recovery', () => {
  it.each([{ body: quoted, expected: undefined }, { body: `学生的回答：\n${original}`, expected: original }])(
    'recovers only student-authored text: $expected', async ({ body, expected }) => {
      const query = vi.fn().mockResolvedValueOnce({ rows: [{ body: assistant }] })
        .mockResolvedValueOnce({ rows: [{ original, body }] });
      expect(await recoverProblemFraming({ query } as TenantSession, actor, stage, entityId)).toBe(expected);
      const [sql, params] = query.mock.calls[1]!;
      expect(sql).toContain("m.org_id=$1 AND m.thread_id=$2 AND m.author_kind='human'");
      expect(sql).toContain('m.created_at <= $4');
      expect(sql).toContain('LIMIT 32');
      expect(params).toEqual([actor.orgId, actor.threadId, [original], stage.updatedAt]);
    });
});
