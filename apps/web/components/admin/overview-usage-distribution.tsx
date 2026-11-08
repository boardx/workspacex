'use client';
import {BarChart3,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {OrganizationSection} from '@/components/org-admin/organization-content';
import {useI18n} from '@/lib/i18n/provider';
import type {GetUsageReportOut,UsageWindowKey} from '@/lib/live-org-admin';

/** The API exposes model aggregates, not a time series. Never synthesize a trend from totals. */
export function OverviewUsageDistribution({usage,error,window:usageWindow,onWindowChange,onRefresh}:{usage:GetUsageReportOut|null;error:boolean;window:UsageWindowKey;onWindowChange:(window:UsageWindowKey)=>void;onRefresh:()=>void}){
 const {t,locale}=useI18n();
 const fmt=new Intl.NumberFormat(locale);
 const percent=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1});
 return <OrganizationSection testId="admin-overview-model-usage" title={<span className="flex items-center gap-2"><BarChart3 aria-hidden className="h-4 w-4"/>{t('orgOverviewRedesign.modelUsage')}</span>} description={t('orgOverviewRedesign.modelHint')} actions={<><div role="group" aria-label={t('orgOverviewRedesign.usagePeriod')} className="flex flex-wrap gap-1 rounded-lg bg-muted/40 p-1">{(['today','week','month'] as const).map(window=><Button key={window} size="xs" variant={usageWindow===window?'primary':'ghost'} aria-pressed={usageWindow===window} onClick={()=>onWindowChange(window)}>{t(window==='today'?'aiUsage.today':window==='week'?'aiUsage.thisWeek':'aiUsage.thisMonth')}</Button>)}</div><Button size="xs" variant="outline" aria-label={t('orgOverviewRedesign.refresh')} disabled={!usage&&!error} onClick={onRefresh}><RefreshCw aria-hidden className="h-4 w-4"/></Button></>}>
  {error?<p role="alert" className="p-5 text-13 text-muted-foreground">{t('adminOverview.dependencyFailure')}</p>:!usage?<div data-testid="admin-overview-usage-loading" className="flex animate-pulse flex-col gap-4 p-5">{[1,2,3].map(i=><div key={i} className="h-8 rounded bg-muted/50"/>)}</div>:usage.distribution.length===0?<p className="px-5 py-10 text-center text-13 text-muted-foreground" data-testid="admin-overview-model-usage-empty">{t('orgOverviewRedesign.noModels')}</p>:<div className="flex flex-col gap-5 p-5 sm:p-6">{usage.distribution.map(model=><div key={model.modelId} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center sm:gap-5"><div className="min-w-0 break-words text-13 font-medium">{model.modelId}</div><div className="h-2 overflow-hidden rounded-full bg-muted sm:col-span-1"><div className="h-full rounded-full bg-background-foreground transition-all" style={{width:`${Math.max(0,Math.min(1,model.share))*100}%`}} role="progressbar" aria-label={model.modelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.share*100)}/></div><div className="flex items-center justify-between gap-4 text-12 tabular-nums sm:justify-end"><span>{fmt.format(model.tokens)} Token</span><span className="text-muted-foreground">{percent.format(model.share)}</span></div></div>)}</div>}
 </OrganizationSection>;
}
