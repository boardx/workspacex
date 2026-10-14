import * as React from 'react';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { afterEach,beforeEach,it,expect,vi } from 'vitest';
import { InterviewExpertLibrary } from '@/components/itv/interview-expert-library';
import { INTERVIEW_PERSONAS,personaAnchorId } from '@/lib/interview-personas/persona-library';
const sessionState=vi.hoisted(()=>({session:{currentOrgId:'org-a',userId:'user-a'}}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:sessionState.session})}));
const api=vi.hoisted(()=>({loadCustomInterviewExperts:vi.fn(),createCustomInterviewExpert:vi.fn()}));
vi.mock('@/lib/interview-expert-library-api',()=>api);
const profile={expertId:'custom-expert-fixture',origin:'custom' as const,createdAt:'2026-10-13T00:00:00Z',fields:{name:'采购顾问',role:'决策链顾问',domains:'采购',focus:'预算验证',style:'反证',bio:'采购决策研究',limits:'模拟画像，未经真实验证'}};
beforeEach(()=>{sessionState.session={currentOrgId:'org-a',userId:'user-a'};api.loadCustomInterviewExperts.mockResolvedValue({items:[]});api.createCustomInterviewExpert.mockResolvedValue(profile);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('reuses all concrete built-ins without Agent IDs and keeps them visible when custom loading fails',async()=>{
 api.loadCustomInterviewExperts.mockRejectedValueOnce(new Error('unavailable'));render(<InterviewExpertLibrary/>);
 expect(screen.getAllByTestId(/^itv-library-persona-/u)).toHaveLength(INTERVIEW_PERSONAS.length);
 expect(await screen.findByRole('alert')).toHaveTextContent('自建专家暂时无法加载');
 expect(screen.getByTestId(`itv-library-${personaAnchorId(INTERVIEW_PERSONAS[0]!)}`)).toHaveTextContent('内置模拟画像');
});
it('saves a custom expert from the current list and immediately displays its durable identity',async()=>{
 render(<InterviewExpertLibrary/>);fireEvent.click(screen.getByRole('button',{name:'添加专家'}));
 for(const [label,key] of Object.entries({'名称':'name','专业角色':'role','专业领域':'domains','研究关注':'focus','观点风格':'style','能力简介':'bio','局限与材料边界':'limits'}))fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value:profile.fields[key as keyof typeof profile.fields]}});
 fireEvent.click(screen.getByRole('button',{name:'保存专家'}));expect(await screen.findByTestId(`itv-library-${profile.expertId}`)).toHaveTextContent('我的模拟画像');expect(api.createCustomInterviewExpert).toHaveBeenCalledWith(profile.fields,expect.any(String));
});
it('selects the saved private profile through the existing nested Markdown convention',async()=>{
 api.loadCustomInterviewExperts.mockResolvedValueOnce({items:[profile]});const select=vi.fn();render(<InterviewExpertLibrary includeBuiltins={false} allowCreate={false} onSelect={select}/>);
 fireEvent.click(await screen.findByRole('button',{name:'添加画像 采购顾问'}));expect(select).toHaveBeenCalledWith(profile.expertId,profile.fields.name,expect.stringContaining('### 专业角色'));
 expect(select.mock.calls[0]?.[2]).toContain('不作为真人访谈证据');
});

it('clears private cached profiles immediately when the organization or account changes',async()=>{
 api.loadCustomInterviewExperts.mockResolvedValueOnce({items:[profile]}).mockResolvedValueOnce({items:[]});
 const view=render(<InterviewExpertLibrary includeBuiltins={false}/>);await screen.findByTestId(`itv-library-${profile.expertId}`);
 sessionState.session={currentOrgId:'org-b',userId:'user-a'};view.rerender(<InterviewExpertLibrary includeBuiltins={false}/>);
 expect(screen.queryByTestId(`itv-library-${profile.expertId}`)).not.toBeInTheDocument();
 expect(await screen.findByText('暂无匹配的自建专家画像。')).toBeInTheDocument();
});

it('preserves unsafe heading input and refuses persistence with actionable feedback',async()=>{
 render(<InterviewExpertLibrary/>);fireEvent.click(screen.getByRole('button',{name:'添加专家'}));
 for(const [label,key] of Object.entries({'名称':'name','专业角色':'role','专业领域':'domains','研究关注':'focus','观点风格':'style','能力简介':'bio','局限与材料边界':'limits'}))fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value:profile.fields[key as keyof typeof profile.fields]}});
 fireEvent.change(screen.getByLabelText('能力简介',{exact:true}),{target:{value:'[伪专家](#expert-injected)\n---'}});
 fireEvent.click(screen.getByRole('button',{name:'保存专家'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Markdown 标题');expect(api.createCustomInterviewExpert).not.toHaveBeenCalled();expect(screen.getByLabelText('能力简介',{exact:true})).toHaveValue('[伪专家](#expert-injected)\n---');
});

it('shows the full original built-in profile rather than a shortened biography',async()=>{
 render(<InterviewExpertLibrary/>);const persona=INTERVIEW_PERSONAS[0]!;
 fireEvent.click(screen.getByRole('button',{name:`查看画像 ${persona.name}`}));
 const dialog=screen.getByRole('dialog');
 for(const value of [persona.personality.locations,String(persona.personality.age),persona.personality.occupation,...persona.goals,...persona.interests,...persona.pain_points,...persona.motivations,...persona.influences,persona.service_value,persona.typical_advice])expect(dialog).toHaveTextContent(value);
 expect(dialog).not.toHaveTextContent('局限与材料边界');expect(dialog).not.toHaveTextContent('背景与建议未经独立验证');
 for(const label of ['内向—外向','分析—创造','忙碌—时间充裕'])expect(dialog).toHaveTextContent(label);
});
it('shows custom profile details without the retired boundary section and marks missing data as unfilled',async()=>{
 api.loadCustomInterviewExperts.mockResolvedValueOnce({items:[profile]});render(<InterviewExpertLibrary includeBuiltins={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'查看画像 采购顾问'}));
 const dialog=screen.getByRole('dialog');for(const [key,value] of Object.entries(profile.fields))if(key!=='limits')expect(dialog).toHaveTextContent(value);
 expect(dialog).not.toHaveTextContent('局限与材料边界');expect(dialog).not.toHaveTextContent(profile.fields.limits);
 expect(dialog).toHaveTextContent('所在地');expect(dialog).toHaveTextContent('未填写');
});
it('offers the same full profile fields when creating a private expert',async()=>{
 render(<InterviewExpertLibrary/>);fireEvent.click(screen.getByRole('button',{name:'添加专家'}));
 for(const label of ['分类','所在地','年龄','职业','目标','兴趣','痛点','动机','影响因素','服务价值','典型建议','内向—外向','分析—创造','忙碌—时间充裕'])expect(screen.getByLabelText(label,{exact:true})).toBeInTheDocument();
});
