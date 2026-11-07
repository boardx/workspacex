"use client";
import * as React from "react";
import {billingSubscription} from "@repo/contracts";
import {apiRequest} from "@/lib/api-client";
import {Button} from "@/components/ui/button";
type History=ReturnType<typeof billingSubscription.operations.getSubscriptionHistory.out.parse>;
const PAGE_SIZE=5;
const date=(value:string|null)=>value?new Date(value).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"}):"未记录";
export function SubscriptionHistory({sessionToken}:{sessionToken:string}){
 const [offset,setOffset]=React.useState(0),[revision,refresh]=React.useReducer(n=>n+1,0);
 const [state,setState]=React.useState<{status:"loading"}|{status:"error"}|{status:"ready";data:History}>({status:"loading"});
 React.useEffect(()=>{
  const controller=new AbortController();setState({status:"loading"});
  const op=billingSubscription.operations.getSubscriptionHistory;
  void apiRequest<unknown>(op.path,{sessionToken,query:{limit:String(PAGE_SIZE),offset:String(offset)},signal:controller.signal})
   .then(raw=>{const data=op.out.parse(raw);if(!controller.signal.aborted)setState({status:"ready",data});})
   .catch(()=>{if(!controller.signal.aborted)setState({status:"error"});});
  return()=>controller.abort();
 },[sessionToken,offset,revision]);
 return <section aria-label="订阅历史" className="space-y-3 border-t pt-5">
  <div className="flex items-center justify-between"><h3 className="text-13 font-medium">订阅历史</h3><Button variant="ghost" size="sm" aria-label="刷新订阅历史" onClick={refresh} disabled={state.status==="loading"}>刷新</Button></div>
  {state.status==="loading"&&<p role="status" className="text-12 text-muted-foreground">正在查询…</p>}
  {state.status==="error"&&<div className="flex items-center gap-2"><p role="status" className="text-12 text-muted-foreground">暂时无法查询订阅历史</p><Button variant="ghost" size="sm" onClick={refresh}>重试</Button></div>}
  {state.status==="ready"&&(state.data.items.length?<div className="overflow-x-auto"><table aria-label="订阅历史" className="w-full text-left text-12"><thead className="text-muted-foreground"><tr><th scope="col" className="pb-2 font-normal">订阅项</th><th scope="col" className="pb-2 font-normal">开始 / 结束</th><th scope="col" className="pb-2 text-right font-normal">费用</th></tr></thead><tbody>{state.data.items.map(row=><tr key={row.id} className="border-t"><td className="py-3 pr-2 align-top">{row.item}</td><td className="whitespace-nowrap py-3 pr-2"><div>{date(row.periodStart)}</div><div className="text-muted-foreground">{date(row.periodEnd)}</div></td><td className="py-3 text-right align-top tabular-nums">{row.amountMinor===null||row.currency===null?"未记录":new Intl.NumberFormat("zh-CN",{style:"currency",currency:row.currency,currencyDisplay:"narrowSymbol"}).format(row.amountMinor/100)}</td></tr>)}</tbody></table></div>:<p className="text-12 text-muted-foreground">暂无订阅记录</p>)}
  {(offset>0||state.status==="ready"&&state.data.hasMore)&&<div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={offset===0||state.status==="loading"} onClick={()=>setOffset(n=>Math.max(0,n-PAGE_SIZE))}>上一页</Button><Button variant="ghost" size="sm" disabled={state.status!=="ready"||!state.data.hasMore} onClick={()=>setOffset(n=>n+PAGE_SIZE)}>下一页</Button></div>}
 </section>;
}
