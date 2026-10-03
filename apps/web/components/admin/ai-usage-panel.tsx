"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table";
import { readAiUsage,readAiUsageCalls,type UsageQuery,type UsageSummary,type UsageCalls } from "@/lib/live-ai-usage";
const tokens=(value:string|null)=>value===null?"未报告":BigInt(value).toLocaleString();
const timestamp=(value:string|null,timezone:string)=>value===null?"未记录":new Date(value).toLocaleString(undefined,{timeZone:timezone});
/** Same ledger endpoints for platform, organization admin and self-only members. */
export function AiUsagePanel({orgId,platform=false,selfUserId}:{orgId:string;platform?:boolean;selfUserId?:string}){
 const initial=React.useMemo(()=>{const end=new Date();return {start:new Date(end.getTime()-7*86400000).toISOString().slice(0,16),end:end.toISOString().slice(0,16)};},[]);
 const [start,setStart]=React.useState(initial.start),[end,setEnd]=React.useState(initial.end);
 const [timezone,setTimezone]=React.useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
 const [provider,setProvider]=React.useState(""),[model,setModel]=React.useState("");
 const [query,setQuery]=React.useState<UsageQuery>(()=>({start:initial.start+":00Z",end:initial.end+":00Z",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,limit:25}));
 const [summary,setSummary]=React.useState<UsageSummary|null>(null),[calls,setCalls]=React.useState<UsageCalls|null>(null);
 const [cursor,setCursor]=React.useState<{occurredAt:string;id:string}|null>(null),[error,setError]=React.useState(false);
 React.useEffect(()=>{let active=true;setSummary(null);setCalls(null);setError(false);setCursor(null);
  void readAiUsage(orgId,platform,{...query,userId:selfUserId??query.userId}).then(out=>{if(active)setSummary(out);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[orgId,platform,query,selfUserId]);
 React.useEffect(()=>{if(!summary)return;let active=true;setCalls(null);setError(false);
  void readAiUsageCalls(orgId,platform,{...query,userId:selfUserId??query.userId,asOf:summary.asOf,...(cursor?{cursorTime:cursor.occurredAt,cursorId:cursor.id}:{})})
   .then(out=>{if(active)setCalls(out);}).catch(()=>{if(active)setError(true);});
  return()=>{active=false;};
 },[orgId,platform,query,summary,cursor,selfUserId]);
 function apply(){try{const begin=new Date(start+"Z"),finish=new Date(end+"Z");if(!Number.isFinite(begin.getTime())||finish<=begin)throw new Error();
  new Intl.DateTimeFormat("en",{timeZone:timezone});setQuery({start:begin.toISOString(),end:finish.toISOString(),timezone,
   modelProvider:provider.trim()||undefined,modelId:model.trim()||undefined,limit:25});}catch{setError(true);}}
 return <section aria-label="AI用量" className="mt-6 space-y-4 rounded-lg border p-4">
  <h2 className="text-16 font-semibold">AI 用量</h2>
  <p className="text-13 text-muted-foreground">当前覆盖不完整：仅展示已落账调用；发送意图未结算和未接入供应商不能当作零消耗。报表不展示提示词或回复内容。</p>
  <div className="grid gap-2 md:grid-cols-3"><label>开始（UTC）<Input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label>
   <label>结束（UTC，不含）<Input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label>
   <label>展示时区<Input value={timezone} onChange={e=>setTimezone(e.target.value)}/></label>
   <label>供应商<Input value={provider} onChange={e=>setProvider(e.target.value)}/></label><label>模型<Input value={model} onChange={e=>setModel(e.target.value)}/></label>
   <Button onClick={apply}>查询用量</Button></div>
  <p className="text-13">当前筛选：成员 {selfUserId??query.userId??"有权查看的全部成员"} · 供应商 {query.modelProvider??"全部"} · 模型 {query.modelId??"全部"} · 项目 {query.projectId??(query.unassignedProject==="true"?"未归属项目":"全部")}</p>
  <Button variant="ghost" onClick={()=>{setProvider("");setModel("");setQuery({...query,userId:undefined,modelProvider:undefined,modelId:undefined,projectId:undefined,unassignedProject:undefined});}}>清除分组筛选</Button>
  {error&&<p role="alert">用量未能加载，请检查时间与权限后重试。</p>}
  {!summary&&!error&&<p role="status">正在加载用量…</p>}
  {summary&&<>
   <div className="grid gap-2 md:grid-cols-3"><p>已记录 Token：{tokens(summary.current.totalTokens)}</p>
    <p>输入：{tokens(summary.current.inputTokens)} · 未报告 {summary.current.unknownInputCalls} 次</p><p>输出：{tokens(summary.current.outputTokens)} · 未报告 {summary.current.unknownOutputCalls} 次</p></div>
   <p>调用 {summary.current.callCount} 次 · 失败 {summary.current.failedCalls} 次 · 已报告 {summary.current.reportedCalls} 次 · 未报告总量 {summary.current.unknownCalls} 次 · 历史口径 {summary.current.legacyCalls} 次</p>
   <p>发送意图 {summary.dispatchIntents} 次 · 未结算 {summary.unsettledDispatchIntents} 次</p>
   <p>上一等长窗口：{tokens(summary.previous.totalTokens)} Token / {summary.previous.callCount} 次调用</p>
   {Object.values(summary.truncated).some(Boolean)&&<p>分组结果已达展示上限，请缩短窗口或使用成员/模型筛选。</p>}
   <h3 className="font-semibold">每日趋势（{summary.timezone}）</h3><div className="flex flex-wrap gap-3">{summary.trend.map(day=><p key={day.day}>{day.day}：{tokens(day.totalTokens)}</p>)}</div>
   <h3 className="font-semibold">成员排名</h3><div className="flex flex-wrap gap-2">{summary.members.map(member=><Button key={member.userId} variant="outline" onClick={()=>setQuery({...query,userId:member.userId})}>{member.userId} · {tokens(member.totalTokens)}</Button>)}
    {query.userId&&<Button variant="ghost" onClick={()=>setQuery({...query,userId:undefined})}>全部有权查看的成员</Button>}</div>
   <h3 className="font-semibold">供应商与模型分布</h3><div className="flex flex-wrap gap-2">{summary.models.map(item=><Button key={item.modelProvider+":"+item.modelId} variant="outline" onClick={()=>setQuery({...query,modelProvider:item.modelProvider,modelId:item.modelId})}>{item.modelProvider} / {item.modelId} · {tokens(item.totalTokens)}</Button>)}</div>
   <h3 className="font-semibold">成员 × 模型</h3><div className="flex flex-wrap gap-2">{summary.matrix.map(item=><Button key={item.userId+":"+item.modelProvider+":"+item.modelId} variant="outline" onClick={()=>setQuery({...query,userId:item.userId,modelProvider:item.modelProvider,modelId:item.modelId})}>{item.userId} / {item.modelProvider} / {item.modelId} · {tokens(item.totalTokens)}</Button>)}</div>
   <h3 className="font-semibold">项目归因</h3><div className="flex flex-wrap gap-2">{summary.projects.map(item=><Button key={item.projectId??"unassigned"} variant="outline" onClick={()=>setQuery({...query,projectId:item.projectId??undefined,unassignedProject:item.projectId===null?"true":undefined})}>{item.projectId??"未归属项目"} · {tokens(item.totalTokens)}</Button>)}</div>
   <h3 className="font-semibold">调用详情</h3>
   {!calls&&!error&&<p>正在加载调用…</p>}{calls&&<>
    <Table><TableHeader><TableRow><TableHead>时间/调用</TableHead><TableHead>成员/归因</TableHead><TableHead>模型</TableHead><TableHead>输入/输出/总量</TableHead><TableHead>口径/结果</TableHead><TableHead>费用</TableHead></TableRow></TableHeader>
     <TableBody>{calls.calls.map(call=><TableRow key={call.id}><TableCell>{timestamp(call.startedAt??call.occurredAt,summary.timezone)}<div className="text-12">{call.id}</div></TableCell>
      <TableCell>{call.userId}<div className="text-12">{call.projectId??"未归属项目"} · {call.runId??"无运行归因"}</div></TableCell>
      <TableCell>{call.modelProvider} / {call.modelId}</TableCell><TableCell>{tokens(call.inputTokens)} / {tokens(call.outputTokens)} / {call.totalSource==="unknown"?"未报告":tokens(call.totalTokens)}</TableCell>
      <TableCell>{call.totalSource} · {call.outcome}</TableCell><TableCell>{call.costMicros===null?"未配置价格/未报告":`${BigInt(call.costMicros)/1000000n}.${(BigInt(call.costMicros)%1000000n).toString().padStart(6,"0")} ${call.currency}`}<div className="text-12">{call.priceVersion??""}</div></TableCell></TableRow>)}</TableBody></Table>
    {calls.calls.length===0&&<p>此窗口与筛选下没有已落账调用。</p>}
    <div className="flex gap-2"><Button variant="outline" disabled={!cursor} onClick={()=>setCursor(null)}>回到首页</Button><Button variant="outline" disabled={!calls.nextCursor} onClick={()=>setCursor(calls.nextCursor)}>下一页调用</Button></div>
   </>}
  </>}
 </section>;
}
