import { expect, it, vi } from 'vitest';
import { apiRequest } from '@/lib/api-client';
import { getReportFileJob } from '@/lib/report-files-api';
vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn(), apiUrl: vi.fn(), getStoredSessionToken: vi.fn() }));
it('restoration uses only an observation GET and preserves the canonical Credit body through response parsing', async () => {
  const job = { id: 'job', source: { kind: 'interview', id: 'report', reportVersion: 1, reportHash: 'a'.repeat(64) }, format: 'pdf', createdAt: '2026-11-08T00:00:00Z', status: 'failed', errorCode: 'CREDIT_REQUIRED',
    creditFailure: { code: 'credit_required', ownerType: 'user', ownerId: 'actor', rechargePath: '/billing?purchase=1' } };
  vi.mocked(apiRequest).mockResolvedValue(job);
  const signal = new AbortController().signal;
  expect(await getReportFileJob('job', signal, { observeOnly: true })).toEqual(job);
  expect(apiRequest).toHaveBeenCalledWith('/report-files/job?observeOnly=true', { signal });
});
