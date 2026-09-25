import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SurveyAppShell } from '@/components/survey/shell/survey-app-shell';
const shell=vi.hoisted(()=>vi.fn());
const location=vi.hoisted(()=>({path:'/studio/survey',query:''}));
vi.mock('next/navigation',()=>({usePathname:()=>location.path,useSearchParams:()=>new URLSearchParams(location.query)}));
vi.mock('@/components/shell/app-shell',()=>({AppShell:(props:{children:ReactNode;left:ReactNode})=>{shell(props);return <div data-testid="shared-app-shell"><aside>{props.left}</aside>{props.children}</div>;}}));
beforeEach(()=>{shell.mockClear();location.path='/studio/survey';location.query='';});
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
 it('keeps the three real resource destinations without fake counts',()=>{
  render(<SurveyAppShell><div>编辑器</div></SurveyAppShell>);
  const links=screen.getAllByRole('link');
  expect(links).toHaveLength(3);
  expect(screen.getByRole('link',{name:'问卷列表'})).toHaveAttribute('href','/studio/survey');
  expect(screen.getByRole('link',{name:'问卷模板'})).toHaveAttribute('href','/studio/survey?tab=modules');
  expect(screen.getByRole('link',{name:'报告模板'})).toHaveAttribute('href','/studio/survey?tab=reports');
 });
 it.each([['/studio/survey/question-templates/new','','问卷模板'],['/studio/survey/templates/id','','报告模板'],['/studio/survey','tab=modules','问卷模板'],['/studio/survey','tab=reports','报告模板'],['/studio/survey/id','','问卷列表']])('highlights %s %s', (path,query,label)=>{
  location.path=path;location.query=query;
  render(<SurveyAppShell><div>内容</div></SurveyAppShell>);
  expect(screen.getByRole('link',{name:label})).toHaveAttribute('aria-current','page');
  expect(screen.getAllByRole('link').filter(link=>link.getAttribute('aria-current')==='page')).toHaveLength(1);
 });
});
