'use client';
import * as React from 'react';
import {MemberMonthlyCreditLimit,type MemberCreditQuotaSnapshot} from '@repo/contracts/member-credit-quota';
import {useI18n} from '@/lib/i18n/provider';
import {getMemberCreditQuotas,setMemberCreditQuota} from '@/lib/live-member-credit-quota';
import {memberFailure} from '@/lib/admin-member-copy';
import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {AdminModal,Field} from './panel';
type Member=MemberCreditQuotaSnapshot['members'][number];
export function MemberCreditQuotaPanel({orgId}:{orgId:string}){
 const {t,locale}=useI18n();
 const [data,setData]=React.useState<MemberCreditQuotaSnapshot|null>(null);
 const [loadError,setLoadError]=React.useState<unknown>(null);
 const [editing,setEditing]=React.useState<Member|null>(null);
 const [draft,setDraft]=React.useState('');
 const [error,setError]=React.useState<unknown>(null);
 const [invalid,setInvalid]=React.useState(false);
 const [saving,setSaving]=React.useState(false);
 const load=React.useCallback(async()=>{
  setLoadError(null);setData(null);
  try{setData(await getMemberCreditQuotas(orgId));}catch(e){setLoadError(e);}
 },[orgId]);
 React.useEffect(()=>{setEditing(null);void load();},[load]);
 const fmt=(n:number)=>n.toLocaleString(locale,{maximumFractionDigits:2});
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
 if(!data.enterprise)return null;
 return <section className="flex flex-col gap-3" data-testid="admin-member-credit-quotas">
  <h2 className="text-14 font-semibold">{t('adminMemberQuotas.creditTitle')}</h2>
  <p className="text-12 text-muted-foreground">{t('adminMemberQuotas.creditDefault',{amount:fmt(data.defaultMonthlyLimit)})}</p>
  <p className="text-11 text-muted-foreground">{t('adminMemberQuotas.creditMonth',{month:data.month})}</p>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.members.map(m=><Card key={m.userId}><CardContent className="flex flex-col gap-2 pt-4">
   <span className="text-13 font-medium">{m.displayName}</span><span className="text-11 text-muted-foreground">{m.email}</span>
   <span className="text-12" data-testid={`member-credit-usage-${m.userId}`}>{t('adminMemberQuotas.creditUsage',{used:fmt(m.usedCredits),limit:fmt(m.monthlyLimit)})}</span>
   <span className="text-11 text-muted-foreground">{t('adminMemberQuotas.creditHeld',{amount:fmt(m.heldCredits)})}</span>
   <Button size="xs" variant="outline" className="self-start" onClick={()=>{setEditing(m);setDraft(String(m.monthlyLimit));setError(null);setInvalid(false);}} data-testid={`member-credit-adjust-${m.userId}`}>{t('adminMemberQuotas.adjust')}</Button>
  </CardContent></Card>)}</div>
  {editing&&<AdminModal title={t('adminMemberQuotas.adjustTitle',{name:editing.displayName})} testid="member-credit-quota-modal" onClose={()=>{if(!saving)setEditing(null);}} footer={<><Button size="sm" variant="ghost" disabled={saving} onClick={()=>setEditing(null)}>{t('adminCommon.cancel')}</Button><Button size="sm" disabled={saving} onClick={()=>void save()} data-testid="member-credit-save">{t('adminCommon.save')}</Button></>}>
   <Field id="member-credit-limit" label={t('adminMemberQuotas.creditLabel')} value={draft} inputMode="numeric" onChange={e=>setDraft(e.target.value)} data-testid="member-credit-limit"/>
   {invalid&&<p role="alert" className="text-12 text-destructive">{t('adminMemberQuotas.invalid')}</p>}
   {error!=null&&<p role="alert" className="text-12 text-destructive">{memberFailure(error,locale)}</p>}
  </AdminModal>}
 </section>;
}
