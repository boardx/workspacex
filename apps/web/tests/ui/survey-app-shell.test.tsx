import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurveyAppShell } from '@/components/survey/shell/survey-app-shell';
const shell=vi.hoisted(()=>vi.fn());
vi.mock('@/components/shell/app-shell',()=>({AppShell:(props:{children:ReactNode;left?:ReactNode})=>{shell(props);return <div data-testid="shared-app-shell">{props.left && <aside>{props.left}</aside>}{props.children}</div>;}}));
beforeEach(()=>{shell.mockClear();});
describe('SurveyAppShell authenticated boundary',()=>{
 it('keeps the global shell without injecting survey-specific secondary navigation',()=>{
  render(<SurveyAppShell><div data-testid="survey-shell-child">问卷编辑内容</div></SurveyAppShell>);
  expect(shell).toHaveBeenCalled();
  const props=shell.mock.calls[0]![0];
  expect(props.previewRole).toBeNull();
  expect(props.hideRoleSwitcher).toBe(true);
  expect(props).not.toHaveProperty('mockIdentity');
  expect(props.left).toBeUndefined();
  expect(screen.getByTestId('survey-shell-child')).toBeInTheDocument();
  expect(screen.queryByTestId('survey-section-nav')).not.toBeInTheDocument();
 });
});
