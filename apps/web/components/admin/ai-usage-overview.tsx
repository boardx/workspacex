"use client";
import * as React from 'react';
import type {UsageSummary} from '@/lib/live-ai-usage';
import {bucketDay,formatUsageCost,usageBuckets,type UsageGrain} from '@/lib/ai-usage-chart';
import {recordedTotal,recordedBucketTotal} from './ai-usage-format';
import {Button} from '@/components/ui/button';
export function AiUsageOverview({summary,onDetails}:{summary:UsageSummary;onDetails:(day?:string,grain?:UsageGrain)=>void}){
 const [grain,setGrain]=React.useState<UsageGrain>('day');
 const [metric,setMetric]=React.useState<'tokens'|'calls'>('tokens');
 const rows=usageBuckets(summary.trend,grain),max=rows.reduce((m,r)=>r.totalTokens>m?r.totalTokens:m,1n);
 const costRows=Object.entries((summary.dailyCosts??[]).reduce<Record<string,{currency:string;day:string;value:bigint}>>((out,c)=>{const day=bucketDay(c.day,grain),key=day+' '+c.currency;out[key]??={currency:c.currency,day,value:0n};out[key]!.value+=BigInt(c.costMicros);return out;},{})).map(([,row])=>row);
 const maxCost=(currency:string)=>costRows.filter(c=>c.currency===currency).reduce((m,c)=>c.value>m?c.value:m,1n);
 return <div className="space-y-6">
  <div className="grid gap-4 sm:grid-cols-3">
   <div className="rounded-lg border p-4"><p>调用次数</p><strong className="text-24">{summary.current.callCount.toLocaleString()}</strong><p>失败 {summary.current.failedCalls} 次</p></div>
   <div className="rounded-lg border p-4"><p>已记录 Token</p><strong data-testid="usage-overview-tokens" className="text-24">{recordedTotal(summary.current)}</strong></div>
   <div className="rounded-lg border p-4"><p>已记录费用（按配置价格计算）</p>{summary.costs?.length?summary.costs.map(c=><p key={c.currency} className="text-20 font-semibold">{formatUsageCost(c.costMicros,c.currency)}</p>):<p className="text-20 font-semibold">暂无已计价数据</p>}<p>已计价 {summary.costs?.reduce((n,c)=>n+c.pricedCalls,0)??0} 次 · 未计价 {summary.unpricedCalls??summary.current.callCount} 次</p></div>
  </div>
  <p className="text-13 text-muted-foreground">未计价可能由于缺少调用时价格快照或计量数据不完整，不代表免费。不同币种分别汇总，未结算调用不计为零费用。</p>
  <section aria-label="用量趋势" className="rounded-lg border p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">用量趋势 · {summary.timezone}</h3><div className="flex flex-wrap gap-2"><Button variant="outline" aria-pressed={metric==='tokens'} onClick={()=>setMetric('tokens')}>Token</Button><Button variant="outline" aria-pressed={metric==='calls'} onClick={()=>setMetric('calls')}>调用次数</Button>{(['day','week','month'] as const).map((value,i)=><Button key={value} variant={grain===value?'primary':'outline'} aria-pressed={grain===value} onClick={()=>setGrain(value)}>{['按日','按周','按月'][i]}</Button>)}</div></div>
   {rows.length===0?<p className="py-8">此窗口没有已记录调用。</p>:<div className="mt-4 space-y-2">{rows.map(row=>{const label=recordedBucketTotal(summary.current,row.totalTokens.toString()),known=/^[\d,]+$/.test(label),tokenLabel=known?`${label} Token`:label;return <div key={row.day} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-13"><button type="button" className="text-left underline" onClick={()=>onDetails(row.day,grain)} aria-label={`查看 ${row.day} 明细`}>{row.day}</button><div><svg role="img" aria-label={`${row.day}：${tokenLabel}，${row.callCount} 次调用`} viewBox="0 0 100 8" preserveAspectRatio="none" className="h-6 w-full">{(metric==='calls'||known)&&<rect width={metric==='tokens'?Number(row.totalTokens*10000n/max)/100:row.callCount/Math.max(1,...rows.map(r=>r.callCount))*100} height="8" rx="1" fill="currentColor" className="text-primary"/>}</svg><p>{tokenLabel} · {row.callCount} 次</p></div></div>;})}</div>}
   <Button variant="outline" onClick={()=>onDetails()} className="mt-4">查看当前筛选明细</Button>
  </section>
  <section aria-label="费用趋势" className="rounded-lg border p-4"><h3 className="font-semibold">费用趋势</h3>{costRows.length?<div className="mt-4 space-y-3">{costRows.map(row=><div key={row.day+row.currency}><button type="button" className="text-13 underline" onClick={()=>onDetails(row.day,grain)}>{row.day} · {formatUsageCost(row.value.toString(),row.currency)}</button><svg role="img" aria-label={`${row.day} ${formatUsageCost(row.value.toString(),row.currency)}`} viewBox="0 0 100 8" preserveAspectRatio="none" className="h-6 w-full"><rect width={Number(row.value*10000n/maxCost(row.currency))/100} height="8" rx="1" fill="currentColor" className="text-primary"/></svg></div>)}</div>:<p>尚无可绘制的已计价记录。</p>}</section>
 </div>;
}
