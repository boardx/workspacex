'use client';
import * as React from 'react';
import {MemberMonthlyCreditLimit,type MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import {useI18n} from '@/lib/i18n/provider';
import {getMemberCreditQuotas,setMemberCreditQuota,setMemberCreditQuotas} from '@/lib/live-member-credit-quota';
import {ApiError} from '@/lib/api-client';
import {memberFailure} from '@/lib/admin-member-copy';
import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {OrganizationStatCard} from '@/components/org-admin/organization-content';
import {AdminModal,Field} from './panel';
type Member=MemberCreditQuotaSnapshot['members'][number];
export function MemberCreditQuotaPanel({orgId}:{orgId:string}){
 const {t,locale}=useI18n();
 const [query,setQuery]=React.useState('');
 const [page,setPage]=React.useState(1);
 const [status,setStatus]=React.useState('all');
 React.useEffect(()=>setPage(1),[query,status]);
 const [data,setData]=React.useState<MemberCreditQuotaSnapshot|null>(null);
 const [loadError,setLoadError]=React.useState<unknown>(null);
 const [editing,setEditing]=React.useState<Member|null>(null);
 const [batchOpen,setBatchOpen]=React.useState(false);
 const [previewLimit,setPreviewLimit]=React.useState<number|null>(null);
 const [exceptions,setExceptions]=React.useState<Record<string,string>>({});
 const [draft,setDraft]=React.useState('');
 const [error,setError]=React.useState<unknown>(null);
 const [invalid,setInvalid]=React.useState(false);
 const [saving,setSaving]=React.useState(false);
 const load=React.useCallback(async()=>{
  setLoadError(null);setData(null);
  try{setData(await getMemberCreditQuotas(orgId));}catch(e){setLoadError(e);}
 },[orgId]);
 React.useEffect(()=>{setEditing(null);setBatchOpen(false);void load();},[load]);
 const fmt=(n:number)=>n.toLocaleString(locale,{maximumFractionDigits:2});
 const parseLimit=(value:string)=>MemberMonthlyCreditLimit.safeParse(value.trim()===''?NaN:Number(value));
 const minimum=(member:Member)=>Math.ceil((Math.round(member.usedCredits*100)+Math.round(member.heldCredits*100))/100);
 const conflicts=previewLimit===null?[]:(data?.members??[]).filter(member=>minimum(member)>previewLimit);
 const updates=previewLimit===null?[]:(data?.members??[]).flatMap(member=>{
  if(minimum(member)<=previewLimit)return [{userId:member.userId,monthlyLimit:previewLimit}];
  const custom=parseLimit(exceptions[member.userId]??'');
  return custom.success&&custom.data>=minimum(member)?[{userId:member.userId,monthlyLimit:custom.data}]:[];
 });
 const invalidException=conflicts.some(member=>{
  const value=exceptions[member.userId]?.trim();
  if(!value)return false;
  const parsed=parseLimit(value);
  return !parsed.success||parsed.data<minimum(member);
 });
 const quotaError=(failure:unknown)=>failure instanceof ApiError&&failure.reasonCode==='MEMBER_CREDIT_LIMIT_BELOW_USAGE'
  ?t('adminMemberQuotas.usageChanged'):memberFailure(failure,locale);
 async function saveBatch(){
  if(saving)return;
  if(previewLimit===null){
   const parsed=parseLimit(draft);
   if(!parsed.success){setInvalid(true);return;}
   setInvalid(false);setError(null);setExceptions({});setPreviewLimit(parsed.data);
   return;
  }
  if(!updates.length||invalidException)return;
  setSaving(true);setError(null);
  try{await setMemberCreditQuotas(orgId,updates);setBatchOpen(false);await load();}
  catch(e){
   setError(e);
   if(e instanceof ApiError&&(e.status===409||e.status===404)){
    try{setData(await getMemberCreditQuotas(orgId));}catch{/* Keep the error and let the administrator retry. */}
    setPreviewLimit(null);
   }
  }finally{setSaving(false);}
 }
 async function save(){
  if(!editing||saving)return;
  const parsed=MemberMonthlyCreditLimit.safeParse(draft.trim()===''?NaN:Number(draft));
  if(!parsed.success){setInvalid(true);return;}
  setSaving(true);setInvalid(false);setError(null);
  try{await setMemberCreditQuota(orgId,editing.userId,parsed.data);setEditing(null);await load();}
  catch(e){setError(e);}finally{setSaving(false);}
 }
 if(loadError)return <Card><CardContent className="flex items-center gap-2 p-3 text-12"><span>{t('adminMemberQuotas.creditLoadError')}: {memberFailure(loadError,locale)}</span><Button size="xs" variant="outline" onClick={()=>void load()}>{t('adminCommon.retry')}</Button></CardContent></Card>;
 if(!data)return <p className="text-12 text-muted-foreground">{t('adminMemberQuotas.loadingQuota')}</p>;
 if(!data.enterprise)return <Card>
  <CardContent className="space-y-2 p-4" data-testid="admin-member-credit-unavailable">
   <h2 className="text-14 font-semibold">{t('adminMemberQuotas.creditTitle')}</h2>
   <p className="text-12 text-muted-foreground">{t('adminMemberQuotas.creditUnavailable')}</p>
  </CardContent>
 </Card>;
 const filteredMembers=data.members.filter(m=>`${m.displayName} ${m.email}`.toLowerCase().includes(query.toLowerCase())).filter(m=>status==='all'||(status==='exhausted' ? m.usedCredits+m.heldCredits>=m.monthlyLimit : m.usedCredits+m.heldCredits<m.monthlyLimit));
 const pages=Math.max(1,Math.ceil(filteredMembers.length/10));
 const currentPage=Math.min(page,pages);
 const visibleMembers=filteredMembers.slice((currentPage-1)*10,currentPage*10);
 return <section className="flex flex-col gap-3" data-testid="admin-member-credit-quotas">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h2 className="text-14 font-semibold">{t('adminMemberQuotas.creditTitle')}</h2>
   <Button size="sm" variant="outline" disabled={!data.members.length} onClick={()=>{setDraft(String(data.defaultMonthlyLimit));setPreviewLimit(null);setError(null);setInvalid(false);setBatchOpen(true);}}>{t('adminMemberQuotas.batchTitle')}</Button>
  </div>
  <p className="text-12 text-muted-foreground">{t('adminMemberQuotas.creditDefault',{amount:fmt(data.defaultMonthlyLimit)})}</p>
  <p className="text-11 text-muted-foreground">{t('adminMemberQuotas.creditMonth',{month:data.month})}</p>
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
   <OrganizationStatCard label={t('orgControlsRedesign.enterpriseBudget')} value={t('orgControlsRedesign.unlimited')} description={t('orgControlsRedesign.perMember')} />
   <OrganizationStatCard label={t('orgControlsRedesign.members')} value={data.members.length} />
   <OrganizationStatCard label={t('orgControlsRedesign.used')} value={fmt(data.members.reduce((n,m)=>n+m.usedCredits,0))} />
   <OrganizationStatCard label={t('orgControlsRedesign.held')} value={fmt(data.members.reduce((n,m)=>n+m.heldCredits,0))} />
  </div>
  <div className="flex flex-wrap gap-3"><input className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-14" aria-label={t('orgControlsRedesign.searchMembers')} placeholder={t('orgControlsRedesign.searchMembers')} value={query} onChange={e=>setQuery(e.target.value)} /><select className="rounded-md border border-input bg-background px-3 py-2 text-14" aria-label={t('orgControlsRedesign.status')} value={status} onChange={e=>setStatus(e.target.value)}><option value="all">{t('orgControlsRedesign.all')}</option><option value="available">{t('orgControlsRedesign.available')}</option><option value="exhausted">{t('orgControlsRedesign.exhausted')}</option></select></div>
  <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-max text-left text-13"><thead className="bg-muted text-muted-foreground"><tr>{(['members','used','held','remaining','status','actions'] as const).map(k=><th key={k} className="px-4 py-3 font-medium">{t(`orgControlsRedesign.${k}`)}</th>)}</tr></thead><tbody>{visibleMembers.map(m=>{
   const remaining=Math.max(0,m.monthlyLimit-m.usedCredits-m.heldCredits);
   return <tr key={m.userId} className="border-t border-border"><td className="px-4 py-4"><p className="font-medium">{m.displayName}</p><p className="text-12 text-muted-foreground">{m.email}</p></td><td className="px-4 py-4"><span data-testid={`member-credit-usage-${m.userId}`}>{t('adminMemberQuotas.creditUsage',{used:fmt(m.usedCredits),limit:fmt(m.monthlyLimit)})}</span><progress className="mt-2 block h-2 w-full accent-primary" max={Math.max(1,m.monthlyLimit)} value={Math.min(m.monthlyLimit,m.usedCredits+m.heldCredits)} aria-label={t('orgControlsRedesign.used')} /></td><td className="px-4 py-4">{t('adminMemberQuotas.creditHeld',{amount:fmt(m.heldCredits)})}</td><td className="px-4 py-4">{fmt(remaining)}</td><td className="px-4 py-4">{t(remaining>0?'orgControlsRedesign.available':'orgControlsRedesign.exhausted')}</td><td className="px-4 py-4"><Button size="xs" variant="outline" onClick={()=>{setEditing(m);setDraft(String(m.monthlyLimit));setError(null);setInvalid(false);}} data-testid={`member-credit-adjust-${m.userId}`}>{t('adminMemberQuotas.adjust')}</Button></td></tr>;
  })}{filteredMembers.length===0&&<tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('orgControlsRedesign.noMatches')}</td></tr>}</tbody></table></div>
  {pages>1&&<div className="flex flex-wrap items-center justify-end gap-3 text-13"><span>{t('orgControlsRedesign.page',{page:currentPage,total:pages})}</span><Button size="sm" variant="outline" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>{t('orgControlsRedesign.previous')}</Button><Button size="sm" variant="outline" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>{t('orgControlsRedesign.next')}</Button></div>}
  {batchOpen&&<AdminModal title={t('adminMemberQuotas.batchTitle')} testid="member-credit-batch-modal" onClose={()=>{if(!saving)setBatchOpen(false);}} footer={<>
   <Button size="sm" variant="ghost" disabled={saving} onClick={()=>setBatchOpen(false)}>{t('adminCommon.cancel')}</Button>
   {previewLimit!==null&&<Button size="sm" variant="outline" disabled={saving} onClick={()=>setPreviewLimit(null)}>{t('adminMemberQuotas.batchBack')}</Button>}
   <Button size="sm" disabled={saving||(previewLimit!==null&&(!updates.length||invalidException))} onClick={()=>void saveBatch()}>{t(previewLimit===null?'adminMemberQuotas.batchPreview':'adminCommon.save')}</Button>
  </>}>
   {previewLimit===null?<Field id="batch-credit-limit" label={t('adminMemberQuotas.creditLabel')} value={draft} inputMode="numeric" onChange={e=>setDraft(e.target.value)}/>:<>
    <p>{t('adminMemberQuotas.batchSummary',{total:data.members.length,updated:updates.length,amount:fmt(previewLimit)})}</p>
    {conflicts.length>0&&<p>{t('adminMemberQuotas.batchConflict')}</p>}
    <ul className="max-h-64 space-y-3 overflow-y-auto">
     {conflicts.map((member,index)=><li key={member.userId}>
      <p>{member.displayName} · {member.email}</p>
      <p className="text-12 text-muted-foreground">{t('adminMemberQuotas.minimum',{amount:fmt(minimum(member))})}</p>
      <Field id={`batch-credit-exception-${index}`} label={t('adminMemberQuotas.batchException',{name:member.displayName})} value={exceptions[member.userId]??''} inputMode="numeric" onChange={e=>setExceptions(values=>({...values,[member.userId]:e.target.value}))}/>
     </li>)}
    </ul>
   </>}
   {(invalid||invalidException)&&<p role="alert" className="text-destructive">{t('adminMemberQuotas.invalid')}</p>}
   {error!=null&&<p role="alert" className="text-destructive">{quotaError(error)}</p>}
  </AdminModal>}
  {editing&&<AdminModal title={t('adminMemberQuotas.adjustTitle',{name:editing.displayName})} testid="member-credit-quota-modal" onClose={()=>{if(!saving)setEditing(null);}} footer={<><Button size="sm" variant="ghost" disabled={saving} onClick={()=>setEditing(null)}>{t('adminCommon.cancel')}</Button><Button size="sm" disabled={saving} onClick={()=>void save()} data-testid="member-credit-save">{t('adminCommon.save')}</Button></>}>
   <Field id="member-credit-limit" label={t('adminMemberQuotas.creditLabel')} value={draft} inputMode="numeric" onChange={e=>setDraft(e.target.value)} data-testid="member-credit-limit"/>
   {invalid&&<p role="alert" className="text-12 text-destructive">{t('adminMemberQuotas.invalid')}</p>}
   {error!=null&&<p role="alert" className="text-12 text-destructive">{quotaError(error)}</p>}
  </AdminModal>}
 </section>;
}
