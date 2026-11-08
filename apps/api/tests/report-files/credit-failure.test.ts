import { expect, it, vi } from 'vitest';
import { ReportFileJob } from '@repo/contracts/report-files';
import { ChatReportFileRuntime } from '../../src/infrastructure/report-files/chat-report-file-runtime';
import { readAgentRun } from '../../src/application/agent-run/read-run';
import type { StoredReportFileJob } from '../../src/application/report-files/job-ports';
vi.mock('../../src/application/agent-run/read-run', () => ({ readAgentRun: vi.fn() }));
const creditFailure = { code: 'credit_required', ownerType: 'user', ownerId: 'actor', rechargePath: '/billing?purchase=1' };
const source = { kind: 'interview', id: 'report', reportVersion: 1, reportHash: 'a'.repeat(64) };
const failed = { id: 'job', source, format: 'pdf', createdAt: '2026-11-08T00:00:00Z', status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure };
it('the public report-job contract preserves the canonical Credit body', () => {
  expect(ReportFileJob.parse(failed)).toMatchObject({ creditFailure });
});
it('the real Chat adapter retains Credit guidance from the authorized run projection', async () => {
  vi.mocked(readAgentRun).mockResolvedValue({ runId: 'run', threadId: 'thread', status: 'failed', error: 'CREDIT_REQUIRED', skillVersionIds: ['pin'], creditFailure } as never);
  const runtime = new ChatReportFileRuntime({ messages: {}, runs: {} } as never);
  const record = { actor: { orgId: 'org', userId: 'actor' }, runId: 'run', threadId: 'thread', skill: { versionId: 'pin' }, job: { status: 'running' } } as StoredReportFileJob;
  expect(await runtime.read(record)).toMatchObject({ status: 'failed', errorCode: 'CREDIT_REQUIRED', creditFailure });
});

it.each(['CREDIT_ACCOUNTING_UNAVAILABLE', 'GENERATION_FAILED'])('rejects recharge metadata on %s jobs', errorCode => {
  expect(ReportFileJob.safeParse({ ...failed, errorCode }).success).toBe(false);
});
it.each([
  { ownerType: 'user', ownerId: 'another-user' },
  { ownerType: 'team', ownerId: 'another-org' },
])('never returns another account scope: %j', async payer => {
  vi.mocked(readAgentRun).mockResolvedValue({ runId: 'run', threadId: 'thread', status: 'failed', error: 'CREDIT_REQUIRED', skillVersionIds: ['pin'], creditFailure: { ...creditFailure, ...payer } } as never);
  const runtime = new ChatReportFileRuntime({ messages: {}, runs: {} } as never);
  const record = { actor: { orgId: 'org', userId: 'actor' }, runId: 'run', threadId: 'thread', skill: { versionId: 'pin' }, job: { status: 'running' } } as StoredReportFileJob;
  const result = await runtime.read(record);
  expect(result).toMatchObject({ status: 'failed', errorCode: 'CREDIT_ACCOUNTING_UNAVAILABLE' });
  expect(result).not.toHaveProperty('creditFailure');
});
it('reconstructs the billing destination from trusted actor binding instead of trusting a payload query', async () => {
  const { reportCreditFailure } = await import('../../src/application/report-files/credit-failure');
  const actor = { orgId: 'org', userId: 'actor' } as StoredReportFileJob['actor'];
  expect(reportCreditFailure(actor, 'CREDIT_REQUIRED', { ...creditFailure, rechargePath: '/billing?ownerId=someone-else' })).toMatchObject({ creditFailure: { rechargePath: '/billing?purchase=1' } });
  expect(reportCreditFailure(actor, 'CREDIT_ACCOUNTING_UNAVAILABLE', creditFailure)).toEqual({ errorCode: 'CREDIT_ACCOUNTING_UNAVAILABLE' });
  expect(reportCreditFailure(actor, 'CREDIT_REQUIRED', undefined)).toEqual({ errorCode: 'CREDIT_REQUIRED' });
});

it('the actual adapter never wakes a queued run while restoring a historical failed job', async () => {
  vi.mocked(readAgentRun).mockResolvedValue({ runId: 'run', threadId: 'thread', status: 'queued', skillVersionIds: ['pin'] } as never);
  const kick = vi.fn();
  const runtime = new ChatReportFileRuntime({ messages: {}, runs: {}, executor: { kick } } as never);
  const record = { actor: { orgId: 'org', userId: 'actor' }, runId: 'run', threadId: 'thread', skill: { versionId: 'pin' }, job: { status: 'failed' } } as StoredReportFileJob;
  expect(await runtime.read(record)).toMatchObject({ status: 'pending' });
  expect(kick).not.toHaveBeenCalled();
});
it('the actual adapter observes a live queued run without waking it during browser restoration', async () => {
  vi.mocked(readAgentRun).mockResolvedValue({ runId: 'run', threadId: 'thread', status: 'queued', skillVersionIds: ['pin'] } as never);
  const kick = vi.fn();
  const runtime = new ChatReportFileRuntime({ messages: {}, runs: {}, executor: { kick } } as never);
  const record = { actor: { orgId: 'org', userId: 'actor' }, runId: 'run', threadId: 'thread', skill: { versionId: 'pin' }, job: { status: 'running' } } as StoredReportFileJob;
  expect(await runtime.read(record, { observeOnly: true })).toMatchObject({ status: 'pending' });
  expect(kick).not.toHaveBeenCalled();
});

it('the real controller exposes an explicitly observation-only status query and rejects unknown query modes', async () => {
  const { ReportFilesController } = await import('../../src/interface/controllers/report-files.controller');
  const status = vi.fn(async () => failed);
  const controller = new ReportFilesController({ status } as never);
  const actor = { orgId: 'org', userId: 'actor' } as StoredReportFileJob['actor'];
  const id = '00000000-0000-4000-8000-000000000001';
  expect(ReportFileJob.parse(await controller.status(actor, id, { observeOnly: 'true' }))).toMatchObject({ creditFailure });
  expect(status).toHaveBeenCalledWith(actor, id, { observeOnly: true });
  await expect(controller.status(actor, id, { observeOnly: 'false' })).rejects.toMatchObject({ status: 400 });
  await expect(controller.status(actor, id, { bypass: 'true' })).rejects.toMatchObject({ status: 400 });
  expect(status).toHaveBeenCalledTimes(1);
});
