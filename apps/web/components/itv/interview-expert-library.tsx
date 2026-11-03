"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from 'react';
import { useOptionalSession } from '@/components/session/session-provider';
import { Plus, Users } from 'lucide-react';
import { InterviewExpertFields, type InterviewCustomExpert } from '@repo/contracts/interview-expert-library';
import { WorkflowActionButton as ActionButton, WorkflowActionBar } from '@/components/research-studio/research-workflow-actions';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { loadCustomInterviewExperts, createCustomInterviewExpert } from '@/lib/interview-expert-library-api';
import { INTERVIEW_PERSONAS, personaAnchorId } from '@/lib/interview-personas/persona-library';
import { renderVirtualExpertSelection } from '@/lib/interview-virtual-expert';
import { emptyExpertProfile,parseExpertProfileDraft,personaExpertFields } from '@/lib/interview-expert-profile';
import { ExpertProfileInputs,ExpertProfileDetails } from './interview-expert-profile-fields';
const labels={name:'itv.field.name',role:'itv.field.role',domains:'itv.field.domains',focus:'itv.field.focus',style:'itv.field.style',bio:'itv.field.bio',limits:'itv.field.limits'} as const;
const empty=()=>({name:'',role:'',domains:'',focus:'',style:'',bio:'',limits:'模拟画像，仅用于模拟研究，不作为真人访谈证据。'});
type LibraryProps={includeBuiltins?:boolean;allowCreate?:boolean;domain?:string;onCount?:(count:number)=>void;onSelect?:(id:string,name:string,markdown:string)=>void|Promise<void>;disabled?:boolean};
export function InterviewExpertLibrary(props:LibraryProps){
 const session=useOptionalSession()?.session;
 return <LibraryContent key={session?`${session.currentOrgId}:${session.userId}`:'standalone'} {...props}/>;
}
function LibraryContent({includeBuiltins=true,allowCreate=true,domain,onCount,onSelect,disabled=false}:LibraryProps){
 const { t } = useI18n();
 const [items,setItems]=React.useState<readonly InterviewCustomExpert[]>([]);
 const [loading,setLoading]=React.useState(true);const [error,setError]=React.useState<import("@/lib/i18n/messages").MessageKey|''>('');const [epoch,setEpoch]=React.useState(0);
 const [selectionError,setSelectionError]=React.useState<import("@/lib/i18n/messages").MessageKey|''>('');
 const [open,setOpen]=React.useState(false);const [fields,setFields]=React.useState(empty);const [saving,setSaving]=React.useState(false);const [saveError,setSaveError]=React.useState<import("@/lib/i18n/messages").MessageKey|''>('');
 const [profile,setProfile]=React.useState(emptyExpertProfile);
 const createTrigger=React.useRef<HTMLButtonElement|null>(null);
 const detailTrigger=React.useRef<HTMLButtonElement|null>(null);
 function viewDetail(event:React.MouseEvent<HTMLButtonElement>,value:InterviewExpertFields){detailTrigger.current=event.currentTarget;setDetail(value);}
 const requestId=React.useRef<string>('');const [detail,setDetail]=React.useState<InterviewExpertFields|null>(null);
 const builtins=includeBuiltins?INTERVIEW_PERSONAS.filter(p=>!domain||p.category===domain):[];
 const custom=items.filter(item=>!domain||item.fields.domains.split(/[、,，;；]/u).map(value=>value.trim()).includes(domain));
 React.useEffect(()=>{let active=true;setLoading(true);setError('');void loadCustomInterviewExperts().then(result=>{if(active){setItems(result.items);setLoading(false);}},()=>{if(active){setError('itv.library.loadFailed');setLoading(false);}});return()=>{active=false;};},[epoch]);
 React.useEffect(()=>{onCount?.(builtins.length+custom.length);},[builtins.length,custom.length,onCount]);
 async function save(){if(saving)return;let extra;try{extra=parseExpertProfileDraft(profile);}catch{setSaveError('itv.library.invalidProfile');return;}const parsed=InterviewExpertFields.safeParse({...fields,...(extra?{profile:extra}:{})});if(!parsed.success){setSaveError('itv.library.invalidFields');return;}
  setSaving(true);setSaveError('');try{const value=await createCustomInterviewExpert(parsed.data,requestId.current);setItems(current=>[...current.filter(item=>item.expertId!==value.expertId),value]);setOpen(false);setFields(empty());setProfile(emptyExpertProfile());}catch{setSaveError('itv.library.saveFailed');}finally{setSaving(false);}
 }
 return <section data-testid="itv-expert-library" className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{includeBuiltins?t("itv.library.title"):t("itv.library.mine")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("itv.library.hint")}</p></div>{allowCreate&&<ActionButton data-testid="itv-add-library-expert" variant="primary" onClick={event=>{createTrigger.current=event.currentTarget;requestId.current=crypto.randomUUID();setSaveError('');setOpen(true);}}><Plus className="size-4" aria-hidden/>{t("itv.library.add")}</ActionButton>}</div>
  {selectionError&&<p role="alert">{t(selectionError)}</p>}
  {loading&&<p role="status" className="text-sm text-muted-foreground">{t("itv.library.loading")}</p>}
  {error&&<div role="alert"><p>{t(error)}</p><ActionButton variant="outline" onClick={()=>setEpoch(value=>value+1)}>{t("itv.library.retry")}</ActionButton></div>}
  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
   {builtins.map(persona=><article key={persona.id} data-testid={`itv-library-${personaAnchorId(persona)}`} className="rounded-xl border bg-card p-3"><Users className="size-5 text-muted-foreground" aria-hidden/><h4 className="mt-2 font-semibold">{persona.name}</h4><p className="text-sm text-primary">{persona.specialty}</p><p className="mt-1 text-xs text-muted-foreground">{persona.category} · {t("itv.library.builtin")}</p><p className="mt-2 line-clamp-3 text-sm leading-6">{persona.bio}</p><ActionButton variant="outline" className="mt-2" aria-label={t("itv.library.viewNamed", { name: persona.name })} onClick={event=>viewDetail(event,personaExpertFields(persona))}>{t("itv.library.view")}</ActionButton></article>)}
   {custom.map(item=><article key={item.expertId} data-testid={`itv-library-${item.expertId}`} className="rounded-xl border bg-card p-3"><h4 className="font-semibold">{item.fields.name}</h4><p className="text-sm text-primary">{item.fields.role}</p><p className="mt-1 text-xs text-muted-foreground">{item.fields.domains} · {t("itv.library.myProfile")}</p><p className="mt-2 line-clamp-3 text-sm leading-6">{item.fields.bio}</p><div className="mt-2 flex flex-wrap gap-2"><ActionButton variant="outline" aria-label={t("itv.library.viewNamed", { name: item.fields.name })} onClick={event=>viewDetail(event,item.fields)}>{t("itv.library.view")}</ActionButton>{onSelect&&<ActionButton variant="outline" aria-label={t("itv.library.selectNamed", { name: item.fields.name })} disabled={disabled} onClick={()=>{setSelectionError('');void Promise.resolve(onSelect(item.expertId,item.fields.name,renderVirtualExpertSelection(item.fields))).catch(()=>setSelectionError('itv.library.selectFailed'));}}>{t("itv.library.select")}</ActionButton>}</div></article>)}
  </div>
  {!loading&&!error&&!builtins.length&&!custom.length&&<p className="text-sm text-muted-foreground">{t("itv.library.empty")}</p>}
  <Dialog open={open} onOpenChange={value=>{if(!saving)setOpen(value);}}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" onCloseAutoFocus={event=>{if(createTrigger.current?.isConnected){event.preventDefault();createTrigger.current.focus();}}}><DialogTitle>{t("itv.library.createTitle")}</DialogTitle><DialogDescription>{t("itv.library.description")}</DialogDescription><form onSubmit={event=>{event.preventDefault();void save();}} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).map(([key,label])=><label key={key} className={`block text-sm ${['name','role'].includes(key)?'':'sm:col-span-2'}`}>{t(label)}{['name','role','domains'].includes(key)?<Input aria-label={t(label)} value={fields[key as keyof typeof fields]} maxLength={200} onChange={event=>{requestId.current=crypto.randomUUID();setFields(value=>({...value,[key]:event.target.value}));}}/>:<Textarea aria-label={t(label)} value={fields[key as keyof typeof fields]} maxLength={4000} onChange={event=>{requestId.current=crypto.randomUUID();setFields(value=>({...value,[key]:event.target.value}));}}/>}</label>)}</div><ExpertProfileInputs draft={profile} onChange={(key,value)=>{requestId.current=crypto.randomUUID();setProfile(current=>({...current,[key]:value}));}}/>{saveError&&<p role="alert" className="text-sm text-destructive">{t(saveError)}</p>}<WorkflowActionBar placement="footer"><ActionButton type="submit" variant="primary" loading={saving} disabled={saving}>{saving?t("studio.saving"):t("itv.library.save")}</ActionButton></WorkflowActionBar></form></DialogContent></Dialog>
  <Dialog open={Boolean(detail)} onOpenChange={value=>{if(!value)setDetail(null);}}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" onCloseAutoFocus={event=>{event.preventDefault();if(detailTrigger.current?.isConnected)detailTrigger.current.focus();}}><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>{detail?.role} · {t("itv.library.simulated")}</DialogDescription>{detail&&<ExpertProfileDetails fields={detail}/>}</DialogContent></Dialog>
 </section>;
}
