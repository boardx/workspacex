import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResearchNewRoute } from '@/components/research-studio/research-new-route';
const mocks = vi.hoisted(() => ({ push: vi.fn(), link: vi.fn().mockResolvedValue({}) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams('projectId=prj-a') }));
vi.mock('@/lib/live-project-resources', () => ({ linkProjectResource: mocks.link }));
vi.mock('@/components/research-studio/guided-research-six-step-shell', () => ({ GuidedResearchSixStepShell: (p: any) => <div><button onClick={p.onBack}>back</button>{p.main}</div> }));
vi.mock('@/components/research-studio/research-intake', () => ({ ResearchIntake: (p: any) => <button onClick={async () => { await p.onCreated?.('grs-a'); p.onNavigate('directions', 'grs-a'); }}>create</button> }));
describe('project research creation', () => {
 it('links created session before navigating and preserves project context', async () => {
  render(<ResearchNewRoute />); fireEvent.click(screen.getByText('create'));
  await waitFor(() => expect(mocks.link).toHaveBeenCalledWith({ projectId: 'prj-a', kind: 'guided_research', resourceId: 'grs-a' }));
  expect(mocks.push).toHaveBeenCalledWith('/research/grs-a/plan?projectId=prj-a');
  fireEvent.click(screen.getByText('back'));
  expect(mocks.push).toHaveBeenCalledWith('/research?projectId=prj-a');
 });
});
