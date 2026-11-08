import * as React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const router=vi.hoisted(()=>({push:vi.fn(),replace:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
vi.mock('@/components/session/session-provider',()=>({useSession:()=>({session:{currentOrgId:'org-a',userId:'u'},identity:{orgRole:'admin'}})}));
vi.mock('@/components/shell/app-shell',()=>({AppShell:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@/components/admin/admin-nav',()=>({AdminNav:()=>null}));
vi.mock('@/components/admin/agent-screen',()=>({AgentScreen:()=> <div>Agent manager</div>}));
vi.mock('@/components/agent/agent-directory-workspace',()=>({AgentDirectoryWorkspace:()=> <div>Member agents</div>}));
vi.mock('@/components/admin/capability-catalog-screen',()=>({CapabilityCatalogScreen:()=> <div>Catalog entries</div>}));
vi.mock('@/components/admin/public-ai-catalog',()=>({PublicAiCatalog:()=> <div>Public entries</div>}));
vi.mock('@/components/skill/skill-catalog-live',()=>({SkillCatalogLive:()=> <div>Skill library</div>}));
vi.mock('@/components/skill/work-skill-catalog',()=>({WorkSkillCatalog:()=> <div>Work skills</div>}));
import {OrganizationAiCatalog} from '@/components/admin/organization-ai-catalog';
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('retains the selected production directory in the URL and follows restored view props',async()=>{
 window.history.replaceState({},'', '/org-admin/skill?org=org-a');
 const view=render(<OrganizationAiCatalog kind="skill" initialScreen="work-catalog"/>);
 expect(screen.getByText('Work skills')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'平台公共'}));
 expect(router.replace).toHaveBeenCalledWith('/org-admin/skill?org=org-a&screen=public',{scroll:false});
 view.rerender(<OrganizationAiCatalog kind="skill" initialScreen="catalog"/>);
 await waitFor(()=>expect(screen.getByText('Catalog entries')).toBeTruthy());expect(screen.queryByText('Public entries')).toBeNull();
});
it('restores the actual organization Agent management view from a deep link',()=>{
 render(<OrganizationAiCatalog kind="agent" initialScreen="manage"/>);expect(screen.getByText('Agent manager')).toBeTruthy();expect(screen.queryByText('Member agents')).toBeNull();
});
