import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {GuidedResearchFlow} from '@/components/research-studio/guided-research-flow';
import {ResearchNewRoute} from '@/components/research-studio/research-new-route';
import {ResearchStageRoute} from '@/components/research-studio/research-stage-route';
import {runtimeFixture} from '../guided-runtime-fixture';
import {projectResearchHref} from '@/components/project/project-links';
const m=vi.hoisted(()=>({push:vi.fn(),link:vi.fn(async()=>({})),list:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push}),useSearchParams:()=>new URLSearchParams(window.location.search)}));
vi.mock('@/lib/live-project-resources',()=>({linkProjectResource:m.link}));
vi.mock('@/lib/guided-research-api',async original=>({...await original<typeof import('@/lib/guided-research-api')>(),listGuidedResearchSessions:m.list,getGuidedResearchSession:vi.fn(async()=>({title:'Saved research'}))}));
vi.mock('@/components/research-studio/research-intake',()=>({CREATE_DRAFT_KEY:'test-research-draft',ResearchIntake:(p:any)=><button onClick={async()=>{await p.onCreated?.('grs-new');p.onNavigate('outline','grs-new');}}>create-study</button>}));
vi.mock('@/components/research-studio/guided-research-six-step-shell',()=>({GuidedResearchSixStepShell:(p:any)=><div><button onClick={p.onBack}>back-list</button>{p.main}</div>}));
vi.mock('@/components/research-studio/guided-research-live',()=>({GuidedResearchLive:(p:any)=><button onClick={p.onBack}>study-back</button>}));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();sessionStorage.clear();window.history.replaceState({},'','/research?flow=home&projectId=project-entry');});
afterEach(()=>window.history.replaceState({},'','/'));
function follow(anchor:HTMLElement){
 const target=anchor.getAttribute('href')!;
 anchor.addEventListener('click',e=>e.preventDefault(),{once:true});
 fireEvent.click(anchor);
 window.history.pushState({},'',target);
 return new URL(window.location.href);
}
function existing(){const r=runtimeFixture('report');return {sessionId:'grs-existing',title:'Saved study',tags:[],brief:r.brief,briefVersion:1,briefConfirmedAt:null,directions:{candidateVersion:null,confirmedVersion:null,versions:[]},outline:{candidateVersion:null,confirmedVersion:null,versions:[]},stage:'report',resumeStage:'report',status:'completed',progress:100,sourceCount:1,reportId:null,createdAt:'2026-10-01',updatedAt:'2026-10-01'};}
it.each([false, true])('keeps the project through research creation and return (populated: %s)',async(populated)=>{
 m.list.mockResolvedValue({items:populated?[existing()]:[]});
 const home=render(<GuidedResearchFlow step="home" projectId="project-entry"/>);
 await screen.findByTestId(populated?'research-view-grs-existing':'research-history-empty');
 const url=follow(screen.getByRole('link',{name:'新建研究'}));
 expect(url.pathname).toBe('/research/new');expect(url.searchParams.get('projectId')).toBe('project-entry');
 home.unmount();
 const entry=render(<ResearchNewRoute/>);
 fireEvent.click(screen.getByRole('button',{name:'create-study'}));
 await waitFor(()=>expect(m.link).toHaveBeenCalledWith({projectId:'project-entry',kind:'guided_research',resourceId:'grs-new'}));
 expect(m.push).toHaveBeenLastCalledWith('/research/grs-new/plan?projectId=project-entry');
 window.history.pushState({},'',m.push.mock.calls.at(-1)![0]);entry.unmount();
 const study=render(<ResearchStageRoute sessionId="grs-new" stage="plan"/>);
 fireEvent.click(screen.getByRole('button',{name:'study-back'}));
 expect(m.push).toHaveBeenLastCalledWith('/research?projectId=project-entry');
 window.history.pushState({},'',m.push.mock.calls.at(-1)![0]);study.unmount();
 render(<GuidedResearchFlow step="home" projectId="project-entry"/>);
 expect(follow(screen.getByTestId('project-breadcrumb-back')).pathname).toBe('/projects/project-entry');
 expect(window.location.pathname+window.location.search).toBe(projectResearchHref('project-entry','research'));
});
it('preserves project context when opening an existing research card',async()=>{
 m.list.mockResolvedValue({items:[existing()]});
 const view=render(<GuidedResearchFlow step="home" projectId="project-entry"/>);
 fireEvent.click(await screen.findByTestId('research-view-grs-existing'));
 expect(window.location.pathname).toBe('/research/grs-existing/report');
 expect(new URLSearchParams(window.location.search).get('projectId')).toBe('project-entry');
 view.unmount();
});
it('keeps standalone research creation links without a project query',async()=>{
 window.history.replaceState({},'','/research?flow=home');m.list.mockResolvedValue({items:[]});
 render(<GuidedResearchFlow step="home"/>);
 await screen.findByTestId('research-history-empty');
 for(const link of screen.getAllByRole('link',{name:'新建研究'}))expect(link).toHaveAttribute('href','/research/new');
});
