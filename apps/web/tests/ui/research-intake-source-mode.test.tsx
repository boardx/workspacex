import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResearchIntake } from '@/components/research-studio/research-intake';
const m = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/guided-research-api', () => ({ createGuidedResearchSession: m.create, getResearchRuntime: m.get, executeResearchRuntime: m.execute }));
vi.mock('@/components/session/session-provider', () => ({ useOptionalSession: () => null }));
vi.mock('@/components/itv/interview-voice-input', () => ({ InterviewVoiceInput: () => null }));
vi.mock('@/components/research-studio/guided-research-step-layout', () => ({ GuidedResearchStepLayout: (p: any) => p.children }));
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); });
it.each(['materials', 'open'] as const)('persists %s source mode before opening the plan', async mode => {
 const runtime = { sessionId: 'grs-mode', version: 0, currentNode: 'brief', planRevision: 0, errorCode: null, sourcePolicy: { mode: 'open', domains: [], internalSourceIds: ['already-selected'], revision: 1 } };
 m.create.mockResolvedValue({ sessionId: 'grs-mode' }); m.get.mockResolvedValue(runtime);
 m.execute.mockImplementation(async (input: any) => ({ ...runtime, version: 1, sourcePolicy: input.sourcePolicy }));
 const next = vi.fn();
 render(<ResearchIntake session={null} workflow={null} onPending={vi.fn()} onSession={vi.fn()} onWorkflow={vi.fn()} onNavigate={next} />);
 fireEvent.change(screen.getByTestId('research-brief-goal'), { target: { value: '仅分析已提供的测试描述，保留材料缺口' } });
 expect(screen.getByRole('radio', { name: '允许联网检索' })).toBeChecked();
 if (mode === 'materials') fireEvent.click(screen.getByRole('radio', { name: '仅使用本次材料' }));
 fireEvent.click(screen.getByTestId('research-confirm-brief'));
 await waitFor(() => expect(m.execute).toHaveBeenCalled());
 expect(m.execute.mock.calls[0]![0]).toMatchObject({ action: 'refine_source_policy', sourcePolicy: { mode, revision: 2, internalSourceIds: ['already-selected'] } });
 await waitFor(() => expect(next).toHaveBeenCalledWith('outline', 'grs-mode'));
 expect(m.execute.mock.invocationCallOrder[0]!).toBeLessThan(next.mock.invocationCallOrder[0]!);
});

function begin() {
 const next = vi.fn();
 const view = render(<ResearchIntake session={null} workflow={null} onPending={vi.fn()} onSession={vi.fn()} onWorkflow={vi.fn()} onNavigate={next} />);
 fireEvent.change(screen.getByTestId('research-brief-goal'), { target: { value: '只使用获准的测试材料' } });
 fireEvent.click(screen.getByTestId('research-confirm-brief'));
 return { ...view, next };
}
it('does not navigate after leaving while the source policy write is pending', async () => {
 const runtime = { sessionId: 'grs-mode', version: 0, currentNode: 'brief', planRevision: 0, errorCode: null };
 let finish!: (value: unknown) => void;
 m.create.mockResolvedValue({ sessionId: 'grs-mode' }); m.get.mockResolvedValue(runtime);
 m.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const view = begin();
 await waitFor(() => expect(m.execute).toHaveBeenCalledTimes(1)); view.unmount();
 finish({ ...runtime, version: 1, sourcePolicy: { mode: 'open' } });
 await waitFor(() => expect(m.execute).toHaveResolved());
 expect(view.next).not.toHaveBeenCalled();
});
it('reuses an already persisted matching policy without a second steering command', async () => {
 m.create.mockResolvedValue({ sessionId: 'grs-mode' });
 m.get.mockResolvedValue({ sessionId: 'grs-mode', version: 1, currentNode: 'brief', errorCode: null, sourcePolicy: { mode: 'open' } });
 const view = begin();
 await waitFor(() => expect(view.next).toHaveBeenCalledWith('outline', 'grs-mode'));
 expect(m.execute).not.toHaveBeenCalled();
});
it.each([0, 2])('binds policy command identity to the loaded version %i', async version => {
 const runtime = { sessionId: 'grs-mode', version, currentNode: 'brief', planRevision: 0, errorCode: null, sourcePolicy: { mode: 'prioritize', domains: [], internalSourceIds: [], revision: 1 } };
 m.create.mockResolvedValue({ sessionId: 'grs-mode' }); m.get.mockResolvedValue(runtime);
 m.execute.mockImplementation(async (input: any) => ({ ...runtime, version: version + 1, sourcePolicy: input.sourcePolicy }));
 const view = begin();
 await waitFor(() => expect(view.next).toHaveBeenCalled());
 expect(m.execute.mock.calls[0]![0]).toMatchObject({ requestId: `source-policy-grs-mode-${version}-open`, idempotencyKey: `source-policy-grs-mode-${version}-open`, expectedVersion: version });
});
