import { Profiler, useRef } from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResearchReportFileActions } from '@/components/report-files/research-report-file-actions';
import { apiRequest } from '@/lib/api-client';
vi.mock('@/lib/api-client', () => ({ apiRequest: vi.fn(), apiUrl: vi.fn(), getStoredSessionToken: vi.fn(), ApiError: class extends Error {} }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it.each([['PDF','pdf'],['Word','docx']])('submits %s from real source-info through the strict request schema', async (label, format) => {
 const source = { kind: 'research', id: 'grs-report', reportVersion: 7, reportHash: 'a'.repeat(64) };
 let resolveBinding!: (value: unknown) => void;
 const binding = new Promise(resolve => { resolveBinding = resolve; });
 vi.mocked(apiRequest).mockImplementation(async (path) => path.startsWith('/report-files/sources/')
  ? binding
  : { id: 'job', source, format, status: 'failed', errorCode: 'INVALID_FILE', createdAt: '2026-10-19T00:00:00Z' });
 render(<ResearchReportFileActions sessionId={source.id} reportVersion={7} />);
 await act(async () => { resolveBinding({ ...source, title: '研究报告', notices: ['证据范围'] }); });
 fireEvent.click(screen.getByRole('button', { name: `生成 ${label}` }));
 await screen.findByRole('alert');
 expect(apiRequest).toHaveBeenCalledWith('/report-files', expect.objectContaining({ method: 'POST', body: { source, format, requestId: expect.any(String) } }));
});

// A committed button can receive input before passive effects are flushed.
// Trigger the earliest committed interaction without timers or mocked hooks.
function FirstCommittedAction({ sessionId, label }: { sessionId: string; label: string }) {
 const clicked = useRef(false);
 return <Profiler id="first-ready-action" onRender={() => {
  const button = screen.queryByRole('button', { name: `生成 ${label}` });
  if (button && !clicked.current) { clicked.current = true; fireEvent.click(button); }
 }}><ResearchReportFileActions sessionId={sessionId} reportVersion={7} /></Profiler>;
}
it.each([['PDF','pdf'],['Word','docx']])('keeps the first committed %s request alive through mount initialization', async (label, format) => {
 const source = { kind: 'research' as const, id: 'grs-first-frame', reportVersion: 7, reportHash: 'a'.repeat(64) };
 vi.mocked(apiRequest).mockImplementation(async path => path.startsWith('/report-files/sources/')
  ? { ...source, title: '首击报告', notices: ['已保存'] }
  : { id: 'first-job', source, format, status: 'failed', errorCode: 'INVALID_FILE', createdAt: '2026-10-19T00:00:00Z' });
 render(<FirstCommittedAction sessionId={source.id} label={label} />);
 await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/report-files', expect.objectContaining({ method: 'POST', body: { source, format, requestId: expect.any(String) } })));
 expect(await screen.findByRole('alert')).toHaveTextContent('文件生成失败，请重试。');
 expect(screen.getByRole('button', { name: `重新生成 ${label}` })).toBeEnabled();
});
