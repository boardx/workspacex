import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurveyAppShell } from '@/components/survey/shell/survey-app-shell';
const shell=vi.hoisted(()=>vi.fn());
vi.mock('@/components/shell/app-shell',()=>({AppShell:(props:{children:ReactNode;left:ReactNode})=>{shell(props);return <div data-testid="shared-app-shell"><aside>{props.left}</aside>{props.children}</div>;}}));
beforeEach(()=>shell.mockClear());
describe('SurveyAppShell authenticated boundary',()=>{
 it('passes real-session shell configuration without injecting a prototype identity',()=>{
  render(<SurveyAppShell><div data-testid="survey-shell-child">问卷编辑内容</div></SurveyAppShell>);
  expect(shell).toHaveBeenCalled();
  const props=shell.mock.calls[0]![0];
  expect(props.previewRole).toBeNull();
  expect(props.hideRoleSwitcher).toBe(true);
  expect(props).not.toHaveProperty('mockIdentity');
  expect(screen.getByTestId('survey-shell-child')).toBeInTheDocument();
  expect(screen.getByTestId('survey-section-nav')).toBeInTheDocument();
 });
 it('exposes only the persisted survey library rather than prototype-only resource destinations',()=>{
  render(<SurveyAppShell><div>编辑器</div></SurveyAppShell>);
  const links=screen.getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href','/studio/survey');
  expect(links[0]).toHaveAttribute('aria-current','page');
  expect(links[0]).toHaveTextContent('我的问卷');
  expect(screen.queryByTestId('survey-section-nav-modules')).not.toBeInTheDocument();
  expect(screen.queryByTestId('survey-section-nav-reports')).not.toBeInTheDocument();
 });
});
