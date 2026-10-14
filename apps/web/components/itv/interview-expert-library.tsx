"use client";
import * as React from 'react';
import { useOptionalSession } from '@/components/session/session-provider';
import { Plus, Users } from 'lucide-react';
import { InterviewExpertFields, type InterviewCustomExpert } from '@repo/contracts/interview-expert-library';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { loadCustomInterviewExperts, createCustomInterviewExpert } from '@/lib/interview-expert-library-api';
import { INTERVIEW_PERSONAS, personaAnchorId } from '@/lib/interview-personas/persona-library';
import { renderVirtualExpertSelection } from '@/lib/interview-virtual-expert';
import { emptyExpertProfile,parseExpertProfileDraft,personaExpertFields } from '@/lib/interview-expert-profile';
import { ExpertProfileInputs,ExpertProfileDetails } from './interview-expert-profile-fields';
const labels={name:'名称',role:'专业角色',domains:'专业领域',focus:'研究关注',style:'观点风格',bio:'能力简介',limits:'局限与材料边界'} as const;
const empty=()=>({name:'',role:'',domains:'',focus:'',style:'',bio:'',limits:'模拟画像，仅用于模拟研究，不作为真人访谈证据。'});
type LibraryProps={includeBuiltins?:boolean;allowCreate?:boolean;domain?:string;onCount?:(count:number)=>void;onSelect?:(id:string,name:string,markdown:string)=>void|Promise<void>;disabled?:boolean};
export function InterviewExpertLibrary(props:LibraryProps){
 const session=useOptionalSession()?.session;
 return <LibraryContent key={session?`${session.currentOrgId}:${session.userId}`:'standalone'} {...props}/>;
}
function LibraryContent({includeBuiltins=true,allowCreate=true,domain,onCount,onSelect,disabled=false}:LibraryProps){
 const [items,setItems]=React.useState<readonly InterviewCustomExpert[]>([]);
 const [loading,setLoading]=React.useState(true);const [error,setError]=React.useState('');const [epoch,setEpoch]=React.useState(0);
 const [selectionError,setSelectionError]=React.useState('');
 const [open,setOpen]=React.useState(false);const [fields,setFields]=React.useState(empty);const [saving,setSaving]=React.useState(false);const [saveError,setSaveError]=React.useState('');
 const [profile,setProfile]=React.useState(emptyExpertProfile);
 const detailTrigger=React.useRef<HTMLButtonElement|null>(null);
 function viewDetail(event:React.MouseEvent<HTMLButtonElement>,value:InterviewExpertFields){detailTrigger.current=event.currentTarget;setDetail(value);}
 const requestId=React.useRef<string>('');const [detail,setDetail]=React.useState<InterviewExpertFields|null>(null);
 const builtins=includeBuiltins?INTERVIEW_PERSONAS.filter(p=>!domain||p.category===domain):[];
 const custom=items.filter(item=>!domain||item.fields.domains.split(/[、,，;；]/u).map(value=>value.trim()).includes(domain));
 React.useEffect(()=>{let active=true;setLoading(true);setError('');void loadCustomInterviewExperts().then(result=>{if(active){setItems(result.items);setLoading(false);}},()=>{if(active){setError('自建专家暂时无法加载，请重试。');setLoading(false);}});return()=>{active=false;};},[epoch]);
 React.useEffect(()=>{onCount?.(builtins.length+custom.length);},[builtins.length,custom.length,onCount]);
 async function save(){if(saving)return;let extra;try{extra=parseExpertProfileDraft(profile);}catch{setSaveError('请检查完整资料：年龄为非负整数，性格为 1–10 整数，详情不包含 Markdown 标题。');return;}const parsed=InterviewExpertFields.safeParse({...fields,...(extra?{profile:extra}:{})});if(!parsed.success){setSaveError('请填写完整；名称、角色、领域用单行，详情不包含 Markdown 标题或未闭合的代码块。');return;}
  setSaving(true);setSaveError('');try{const value=await createCustomInterviewExpert(parsed.data,requestId.current);setItems(current=>[...current.filter(item=>item.expertId!==value.expertId),value]);setOpen(false);setFields(empty());setProfile(emptyExpertProfile());}catch{setSaveError('保存未完成，输入已保留，请重试。');}finally{setSaving(false);}
 }
 return <section data-testid="itv-expert-library" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{includeBuiltins?'内置与自建专家画像':'我的自建专家画像'}</h3><p className="mt-1 text-xs text-muted-foreground">模拟专业角色，供访谈研究选用；自建画像仅当前账号在当前组织可见。</p></div>{allowCreate&&<Button data-testid="itv-add-library-expert" variant="primary" onClick={()=>{requestId.current=crypto.randomUUID();setSaveError('');setOpen(true);}}><Plus className="size-4" aria-hidden/>添加专家</Button>}</div>
  {selectionError&&<p role="alert">{selectionError}</p>}
  {loading&&<p role="status" className="text-sm text-muted-foreground">正在加载自建专家…</p>}
  {error&&<div role="alert"><p>{error}</p><Button variant="outline" onClick={()=>setEpoch(value=>value+1)}>重试自建专家</Button></div>}
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
   {builtins.map(persona=><article key={persona.id} data-testid={`itv-library-${personaAnchorId(persona)}`} className="rounded-xl border bg-card p-4"><Users className="size-5 text-muted-foreground" aria-hidden/><h4 className="mt-2 font-semibold">{persona.name}</h4><p className="text-sm text-primary">{persona.specialty}</p><p className="mt-1 text-xs text-muted-foreground">{persona.category} · 内置模拟画像</p><p className="mt-3 line-clamp-3 text-sm leading-6">{persona.bio}</p><Button variant="outline" size="sm" className="mt-3" onClick={event=>viewDetail(event,personaExpertFields(persona))}>查看画像 {persona.name}</Button></article>)}
   {custom.map(item=><article key={item.expertId} data-testid={`itv-library-${item.expertId}`} className="rounded-xl border bg-card p-4"><h4 className="font-semibold">{item.fields.name}</h4><p className="text-sm text-primary">{item.fields.role}</p><p className="mt-1 text-xs text-muted-foreground">{item.fields.domains} · 我的模拟画像</p><p className="mt-3 line-clamp-3 text-sm leading-6">{item.fields.bio}</p><div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={event=>viewDetail(event,item.fields)}>查看画像 {item.fields.name}</Button>{onSelect&&<Button size="sm" disabled={disabled} onClick={()=>{setSelectionError('');void Promise.resolve(onSelect(item.expertId,item.fields.name,renderVirtualExpertSelection(item.fields))).catch(()=>setSelectionError('选择未保存，请重试；当前访谈内容已保留。'));}}>添加画像 {item.fields.name}</Button>}</div></article>)}
  </div>
  {!loading&&!error&&!builtins.length&&!custom.length&&<p className="text-sm text-muted-foreground">暂无匹配的自建专家画像。</p>}
  <Dialog open={open} onOpenChange={value=>{if(!saving)setOpen(value);}}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogTitle>添加专家画像</DialogTitle><DialogDescription>保存为个人可复用的模拟画像，不创建真人或 Agent 身份。</DialogDescription><form onSubmit={event=>{event.preventDefault();void save();}} className="space-y-3">{Object.entries(labels).map(([key,label])=><label key={key} className="block text-sm">{label}{['name','role','domains'].includes(key)?<Input aria-label={label} value={fields[key as keyof typeof fields]} maxLength={200} onChange={event=>{requestId.current=crypto.randomUUID();setFields(value=>({...value,[key]:event.target.value}));}}/>:<Textarea aria-label={label} value={fields[key as keyof typeof fields]} maxLength={4000} onChange={event=>{requestId.current=crypto.randomUUID();setFields(value=>({...value,[key]:event.target.value}));}}/>}</label>)}<ExpertProfileInputs draft={profile} onChange={(key,value)=>{requestId.current=crypto.randomUUID();setProfile(current=>({...current,[key]:value}));}}/>{saveError&&<p role="alert" className="text-sm text-destructive">{saveError}</p>}<Button type="submit" disabled={saving}>{saving?'保存中…':'保存专家'}</Button></form></DialogContent></Dialog>
  <Dialog open={Boolean(detail)} onOpenChange={value=>{if(!value)setDetail(null);}}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();if(detailTrigger.current?.isConnected)detailTrigger.current.focus();}}><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>{detail?.role} · 模拟专家画像</DialogDescription>{detail&&<ExpertProfileDetails fields={detail}/>}</DialogContent></Dialog>
 </section>;
}
