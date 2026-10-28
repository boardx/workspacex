import type { UsageSummary } from './live-ai-usage';
export type UsageGrain = 'day' | 'week' | 'month';
export function bucketDay(day:string,grain:UsageGrain){
 const date=new Date(day+'T00:00:00Z');
 if(grain==='month')date.setUTCDate(1);
 if(grain==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString().slice(0,10);
}
export function usageBuckets(trend:UsageSummary['trend'],grain:UsageGrain){
 const map=new Map<string,{day:string;totalTokens:bigint;callCount:number}>();
 for(const row of trend){const day=bucketDay(row.day,grain),current=map.get(day)??{day,totalTokens:0n,callCount:0};current.totalTokens+=BigInt(row.totalTokens);current.callCount+=row.callCount;map.set(day,current);}
 return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
export function formatUsageCost(micros:string,currency:string){
 const value=BigInt(micros);return `${currency} ${value/1000000n}.${(value%1000000n).toString().padStart(6,'0')}`;
}
/** Convert a local calendar midnight to UTC without using the browser's timezone. */
export function usageMidnight(day:string,timezone:string){
 const target=Date.parse(day+'T00:00:00Z');let time=target;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<4;i++){const parts=Object.fromEntries(formatter.formatToParts(time).map(p=>[p.type,p.value]));const local=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);const correction=target-local;if(correction===0)return new Date(time).toISOString();time+=correction;}
 return new Date(time).toISOString();
}
export function usageBucketEnd(day:string,grain:UsageGrain){const d=new Date(day+'T00:00:00Z');if(grain==='month')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+(grain==='week'?7:1));return d.toISOString().slice(0,10);}
