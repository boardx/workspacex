import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResearchReportFileActions } from '@/components/report-files/research-report-file-actions';
import { apiRequest } from '@/lib/api-client';
vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn(), apiUrl: vi.fn(), getStoredSessionToken: vi.fn(), ApiError: class extends Error {} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it.each([['PDF','pdf'],['Word','docx']])('submits %s from real source-info through the strict request schema', async (label, format) => {
 const source = { kind: 'research', id: 'grs-report', reportVersion: 7, reportHash: 'a'.repeat(64) };
 vi.mocked(apiRequest).mockImplementation(async (path) => path.startsWith('/report-files/sources/')
  ? { ...source, title: '研究报告', notices: ['证据范围'] }
  : { id: 'job', source, format, status: 'failed', errorCode: 'INVALID_FILE', createdAt: '2026-10-19T00:00:00Z' });
 render(<ResearchReportFileActions sessionId={source.id} reportVersion={7} />);
 fireEvent.click(await screen.findByRole('button', { name: `生成 ${label}` }));
 await screen.findByRole('alert');
 expect(apiRequest).toHaveBeenCalledWith('/report-files', expect.objectContaining({ method: 'POST', body: { source, format, requestId: expect.any(String) } }));
});
