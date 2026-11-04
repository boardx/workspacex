"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from 'react';
import type {UsageSummary} from '@/lib/live-ai-usage';
import {bucketDay,formatUsageCost,usageBuckets,type UsageGrain} from '@/lib/ai-usage-chart';
import {recordedTotal,recordedBucketTotal} from './ai-usage-format';
import {Button} from '@/components/ui/button';
export function AiUsageOverview({summary,onDetails}:{summary:UsageSummary;onDetails:(day?:string,grain?:UsageGrain)=>void}){
  const { locale, t } = useI18n();
 const [grain,setGrain]=React.useState<UsageGrain>('day');
 const [metric,setMetric]=React.useState<'tokens'|'calls'>('tokens');
 const rows=usageBuckets(summary.trend,grain),max=rows.reduce((m,r)=>r.totalTokens>m?r.totalTokens:m,1n);
 const costRows=Object.entries((summary.dailyCosts??[]).reduce<Record<string,{currency:string;day:string;value:bigint}>>((out,c)=>{const day=bucketDay(c.day,grain),key=day+' '+c.currency;out[key]??={currency:c.currency,day,value:0n};out[key]!.value+=BigInt(c.costMicros);return out;},{})).map(([,row])=>row);
 const maxCost=(currency:string)=>costRows.filter(c=>c.currency===currency).reduce((m,c)=>c.value>m?c.value:m,1n);
 return <div className="min-w-0 space-y-6">
  <div className="grid gap-4 sm:grid-cols-3">
   <div className="rounded-lg border p-4"><p>{t("aiUsage.calls")}</p><strong className="text-24">{summary.current.callCount.toLocaleString(locale)}</strong><p>{t("aiUsage.failures", { count: summary.current.failedCalls })}</p></div>
   <div className="rounded-lg border p-4"><p>{t("aiUsage.recordedTokens")}</p><strong data-testid="usage-overview-tokens" className="text-24">{recordedTotal(summary.current, locale)}</strong></div>
   <div className="rounded-lg border p-4"><p>{t("aiUsage.recordedCostsAtConfiguredPrices")}</p>{summary.costs?.length?summary.costs.map(c=><p key={c.currency} className="text-20 font-semibold">{formatUsageCost(c.costMicros,c.currency)}</p>):<p className="text-20 font-semibold">{t("aiUsage.noPricedData")}</p>}<p>{t("aiUsage.pricingCoverage", { priced: summary.costs?.reduce((n,c)=>n+c.pricedCalls,0)??0, unpriced: summary.unpricedCalls??summary.current.callCount })}</p></div>
  </div>
  <p className="text-13 text-muted-foreground">{t("aiUsage.unpricedUsageDoesNotMeanFree")}</p>
  <section aria-label={t("aiUsage.usageTrend")} className="rounded-lg border p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t("aiUsage.usageTrend")} · {summary.timezone}</h3><div className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={metric==='tokens'} onClick={()=>setMetric('tokens')}>Token</Button><Button variant="outline" aria-pressed={metric==='calls'} onClick={()=>setMetric('calls')}>{t("aiUsage.calls")}</Button>{(['day','week','month'] as const).map((value,i)=><Button key={value} variant={grain===value?'primary':'outline'} aria-pressed={grain===value} onClick={()=>setGrain(value)}>{[t("aiUsage.daily"),t("aiUsage.weekly"),t("aiUsage.monthly")][i]}</Button>)}</div></div>
   {rows.length===0?<p className="py-8">{t("aiUsage.noRecordedCallsInThisWindow")}</p>:<div className="mt-4 space-y-2">{rows.map(row=>{const label=recordedBucketTotal(summary.current,row.totalTokens.toString(), locale),known=/^[\d,]+$/.test(label),tokenLabel=known?`${label} Token`:label;return <div key={row.day} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-13"><button type="button" className="text-left underline" onClick={()=>onDetails(row.day,grain)} aria-label={t("aiUsage.dayDetails", { day: row.day })}>{row.day}</button><div><svg role="img" aria-label={t("aiUsage.chartLabel", { day: row.day, tokens: tokenLabel, count: row.callCount })} viewBox="0 0 100 8" preserveAspectRatio="none" className="h-6 w-full">{(metric==='calls'||known)&&<rect width={metric==='tokens'?Number(row.totalTokens*10000n/max)/100:row.callCount/Math.max(1,...rows.map(r=>r.callCount))*100} height="8" rx="1" fill="currentColor" className="text-primary"/>}</svg><p>{tokenLabel} · {t("aiUsage.callsCount", { count: row.callCount })}</p></div></div>;})}</div>}
   <Button variant="outline" onClick={()=>onDetails()} className="mt-4 h-auto max-w-full whitespace-normal">{t("aiUsage.viewDetailsForCurrentFilters")}</Button>
  </section>
  <section aria-label={t("aiUsage.costTrend")} className="rounded-lg border p-4"><h3 className="font-semibold">{t("aiUsage.costTrend")}</h3>{costRows.length?<div className="mt-4 space-y-3">{costRows.map(row=><div key={row.day+row.currency}><button type="button" className="text-13 underline" onClick={()=>onDetails(row.day,grain)}>{row.day} · {formatUsageCost(row.value.toString(),row.currency)}</button><svg role="img" aria-label={`${row.day} ${formatUsageCost(row.value.toString(),row.currency)}`} viewBox="0 0 100 8" preserveAspectRatio="none" className="h-6 w-full"><rect width={Number(row.value*10000n/maxCost(row.currency))/100} height="8" rx="1" fill="currentColor" className="text-primary"/></svg></div>)}</div>:<p>{t("aiUsage.noPricedRecordsToChartYet")}</p>}</section>
 </div>;
}
