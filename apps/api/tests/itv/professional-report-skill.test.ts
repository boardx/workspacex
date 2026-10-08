import { readFile } from 'node:fs/promises';
import { beforeEach, expect, it, vi } from 'vitest';
import { generateProfessionalInterviewReport } from '../../src/application/interview/generate-professional-interview-report';
import { loadInterviewReportSkill } from '../../src/infrastructure/skill/interview-report-skill';
import { FileSkillStarterPackSource, REPO_SKILL_STARTER_PACK_ROOT } from '../../src/infrastructure/skill/file-skill-starter-pack-source';
import { toOrgId } from '../../src/domain/org-id';
import { ModelCallError } from '../../src/application/agent-run/ports';

const read = vi.hoisted(() => vi.fn());
vi.mock('../../src/application/interview/read-interview-markdown', () => ({ readInterviewMarkdown: read }));
const body = '# 公共活动信息体验报告\n\n## 执行摘要\n' + '现有访谈反映，出行前需要明确的活动状态与变更通知。'.repeat(6) +
  '\n\n## 主题分析\n' + '跨回答综合显示，本地居民与外地游客的查询重点不同，应结合出行成本分别组织信息。'.repeat(6) +
  '\n\n## 综合结论\n信息应同时呈现活动状态、发布时间及入口指引。\n\n适用范围：出行前查询；相反意见来自依赖本地经验的查询场景。\n\n## 建议与行动优先级\n决策影响：优先在活动页面展示状态卡，随后完善异常通知和入口指引。';
const input = { orgId: toOrgId('org-professional-report'), viewerUserId: 'actor', interviewId: 'itv-professional', step: 'report' as const, expectedVersion: 7, expectedDocumentVersion: 1 };
let snapshot: any;
beforeEach(() => {
  snapshot = { interviewId: input.interviewId, revisionId: 'revision', version: 7, execution: null, review: null,
    documents: [{ documentId: 'runs', step: 'runs', version: 2, evidenceMode: 'simulated', markdown: '现有访谈：本地居民关注变更，外地游客关注时间与入口。', references: [], contentHash: 'runs' },
      { documentId: 'report', step: 'report', version: 1, markdown: '旧报告保留', references: [], contentHash: 'old' }],
    states: [{ documentId: 'runs', status: 'completed', failure: null }, { documentId: 'report', status: 'failed', failure: { code: 'REPORT_ACTION_VALIDATION_REJECTED', retryable: true } }] };
  read.mockReset(); read.mockImplementation(async () => structuredClone(snapshot));
});
function setup(result: any = { text: body }) {
  const saveDraft = vi.fn(async (value: any) => { snapshot.version++; snapshot.documents[1] = { ...snapshot.documents[1], markdown: value.markdown, references: value.references, version: 2 }; snapshot.states[1] = { documentId: 'report', status: 'draft', failure: null }; });
  const completeStream = vi.fn(async (_request: any, delta: any) => { await delta(result.text ?? ''); return result; });
  const reportSkill = vi.fn(() => loadInterviewReportSkill(new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT)));
  const deps = { reader: { saveDraft }, model: { complete: vi.fn(), completeStream }, reportSkill, modelProvider: 'fixture', modelId: 'qwen3.7-plus' } as any;
  return { deps, saveDraft, completeStream, reportSkill };
}
it('uses the exact shipped skill and saves a formal report without verification plans or original quotations', async () => {
  const { deps, saveDraft, completeStream, reportSkill } = setup();
  const controller = new AbortController(); const events: any[] = [];
  const result = await generateProfessionalInterviewReport(deps, { ...input, signal: controller.signal, onProgress: event => { events.push(event); } });
  const skill = await reportSkill.mock.results[0]!.value;
  expect(completeStream.mock.calls[0]![0]).toMatchObject({ thinkingMode: 'off', signal: controller.signal });
  expect(completeStream.mock.calls[0]![0].system).toContain(skill);
  expect(completeStream.mock.calls[0]![0].user).not.toContain('旧报告保留');
  expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ markdown: body, expectedVersion: 7, expectedDocumentVersion: 1, references: [{ anchor: 'source-1', documentId: 'runs', version: 2 }] }));
  expect(result.version).toBe(8); expect(result.states[1]!.status).toBe('draft');
  expect(events.filter(event => event.type === 'attempt')).toHaveLength(1);
});
it.each([{ text: '' }, { text: body, truncated: true }, { text: body, cancelled: true }, { text: body, paused: true }, { text: body, interrupted: true }, { text: '{}' }, { text: '# 简短标题' }])('preserves the previous report on incomplete or invalid output %j', async result => {
  const { deps, saveDraft } = setup(result); const before = structuredClone(snapshot);
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow();
  expect(saveDraft).not.toHaveBeenCalled(); expect(snapshot).toEqual(before);
});
it('preserves the old report on a provider failure', async () => {
  const { deps, saveDraft, completeStream } = setup(); completeStream.mockRejectedValue(new ModelCallError('MODEL_CALL_FAILED', 'fixture'));
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow('AI_GENERATION_UNAVAILABLE');
  expect(saveDraft).not.toHaveBeenCalled();
});
it('does not overwrite the old report when cancelled during the storage-stage callback', async () => {
  const { deps, saveDraft } = setup(); const before = structuredClone(snapshot); const controller = new AbortController();
  await expect(generateProfessionalInterviewReport(deps, { ...input, signal: controller.signal, onProgress: event => {
    if (event.type === 'stage' && event.stage === 'storage') controller.abort();
  } })).rejects.toThrow();
  expect(saveDraft).not.toHaveBeenCalled(); expect(snapshot).toEqual(before);
});
it.each(['version', 'document', 'source', 'execution', 'confirmed'] as const)('rejects invalid source/version state before model dispatch: %s', async kind => {
  if (kind === 'version') snapshot.version++;
  if (kind === 'document') snapshot.documents[1].version++;
  if (kind === 'source') snapshot.states[0].status = 'draft';
  if (kind === 'execution') snapshot.execution = { status: 'running' };
  if (kind === 'confirmed') snapshot.states[1].status = 'confirmed';
  const { deps, saveDraft, completeStream } = setup();
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow();
  expect(completeStream).not.toHaveBeenCalled(); expect(saveDraft).not.toHaveBeenCalled();
});
it('loads the published source and rejects tampered skill packs', async () => {
  const text = await loadInterviewReportSkill(new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT));
  expect(text).toBe(await readFile(new URL('../../../../skills/standard-methods/interview-synthesis/SKILL.md', import.meta.url), 'utf8'));
  const pack: any = await new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT).load('standard-methods', '1.5.3');
  pack.skills[0].files[0].contentBase64 = Buffer.from('tampered').toString('base64');
  await expect(loadInterviewReportSkill({ load: async () => pack })).rejects.toThrow();
});

it.each(['observed', 'simulated', 'mixed'])('retains server-controlled source evidence mode without a blanket authenticity assertion: %s', async mode => {
  snapshot.documents[0].evidenceMode = mode;
  const { deps, completeStream } = setup();
  await generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() });
  const request = completeStream.mock.calls[0]![0];
  expect(request.user).toContain(`evidenceMode=${mode}`);
  expect(request.system).not.toContain('现有资料已由用户认证真实有效');
});
it.each(['跨回答综合显示，', '决策影响：', '适用范围：'])('accepts substantive analysis without a prescribed label: %s', async label => {
  const { deps, saveDraft } = setup({ text: body.replaceAll(label, '') });
  await generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() });
  expect(saveDraft).toHaveBeenCalled();
});
it.each(['synthesis', 'decision', 'boundary'])('rejects a formatted report missing analytical substance: %s', async dimension => {
  const invalid = dimension === 'synthesis' ? body.replaceAll('跨回答综合显示，本地居民与外地游客的查询重点不同，应结合出行成本分别组织信息。', '')
    : dimension === 'decision' ? body.replace('决策影响：优先在活动页面展示状态卡，随后完善异常通知和入口指引。', '')
    : body.replace('适用范围：出行前查询；相反意见来自依赖本地经验的查询场景。', '');
  const { deps, saveDraft } = setup({ text: invalid });
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow('AI_GENERATION_UNAVAILABLE');
  expect(saveDraft).not.toHaveBeenCalled();
});
it('rejects a long per-respondent memorandum with headings but no synthesis or decision impact', async () => {
  const memo = '# 访谈纪要\n## 王志远\n' + '他讲述了查询活动的经过。'.repeat(25) + '\n## 李伟诚\n' + '他列举了信息渠道。'.repeat(25) + '\n## 记录摘要\n保留以上回答记录。';
  const { deps, saveDraft } = setup({ text: memo });
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow('AI_GENERATION_UNAVAILABLE');
  expect(saveDraft).not.toHaveBeenCalled();
});

it('rejects labels without analysis and quoted analysis inserted into a memorandum', async () => {
  const memo = '# 访谈纪要\n## 跨回答综合\n' + '他讲述了查询活动的经过。'.repeat(25) + '\n## 决策影响\n' + '他列举了信息渠道。'.repeat(25) + '\n## 适用范围\n保留以上回答记录。\n\n> 本地居民与外地游客的重点不同。优先展示状态卡，随后改善通知。适用于出行前查询。';
  const { deps, saveDraft } = setup({ text: memo });
  await expect(generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() })).rejects.toThrow();
  expect(saveDraft).not.toHaveBeenCalled();
});

it.each(['建议调整入口名称、固定入口位置，并增加视觉提示。', '优先展示活动状态。', '建议调整入口名称、固定入口位置，并增加视觉提示。这些调整应保留熟悉用户的既有操作路径。'])('accepts a concrete recommendation in natural wording: %s', async recommendation => {
  const report = body.replace('决策影响：优先在活动页面展示状态卡，随后完善异常通知和入口指引。', recommendation);
  const { deps, saveDraft } = setup({ text: report });
  await generateProfessionalInterviewReport(deps, { ...input, onProgress: vi.fn() });
  expect(saveDraft).toHaveBeenCalled();
});
