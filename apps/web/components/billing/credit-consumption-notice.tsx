"use client";
import * as React from "react";
import { CREDIT_FAILURE_EVENT, type CreditGuidance } from "@/lib/credit-guidance";
import {CHAT_CREDIT_ATTEMPT_EVENT,emptyCreditNotice,reduceCreditNotice,type CreditAttemptEvent} from "@/lib/chat-credit-attempt";
import { Button } from "@/components/ui/button";
/** Shared copy and validated action for the persistent run row and transient notice. */
export function CreditFailureDetails({notice,onDismiss}:{notice:CreditGuidance;onDismiss?:()=>void}) {
 return <>
 <p className="text-14">{notice.reason === "member_monthly_limit" ? "本月成员 Credit 额度不足，请联系组织管理员调整月度额度，或在下月额度重置后重试。" : notice.code === "credit_accounting_unavailable" ? "计费服务暂时不可用，本次请求未自动重试。请稍后重试或联系管理员。" : notice.rechargePath ? notice.ownerType === "team" ? "组织可用额度不足，请联系组织管理员充值；管理员可在新页面为组织充值。" : "个人 Credit 可用额度不足，请充值后手动继续。" : "Credit 余额或成员月度额度不足，请查看账户额度或联系组织管理员确认月度额度后继续。"}</p>
 <p className="text-12 text-muted-foreground">{notice.code === "credit_accounting_unavailable" ? "当前页面内容已保留，服务恢复后请手动重试。" : notice.reason === "member_monthly_limit" || !notice.ownerType ? "当前页面内容已保留，确认额度后请手动重试。" : "当前页面内容已保留，充值后不会自动重新执行任务。"}</p>
 <div className="flex gap-2">{notice.code === "credit_required" && notice.reason !== "member_monthly_limit" && <Button asChild><a href={notice.rechargePath ?? "/billing"} target="_blank" rel="noopener noreferrer">{notice.rechargePath ? notice.ownerType === "team" ? "为组织充值" : "前往充值" : "查看账户额度"}</a></Button>}{onDismiss&&<Button variant="outline" onClick={onDismiss}>关闭提示</Button>}</div>
 </>;
}
export function CreditConsumptionNotice() {
 const [state,dispatch]=React.useReducer(reduceCreditNotice,emptyCreditNotice);
 React.useEffect(()=>{
  const failure=(event:Event)=>dispatch({type:'failure',raw:(event as CustomEvent).detail});
  const lifecycle=(event:Event)=>dispatch({type:'lifecycle',detail:(event as CustomEvent<CreditAttemptEvent>).detail});
  window.addEventListener(CREDIT_FAILURE_EVENT,failure);window.addEventListener(CHAT_CREDIT_ATTEMPT_EVENT,lifecycle);
  return()=>{window.removeEventListener(CREDIT_FAILURE_EVENT,failure);window.removeEventListener(CHAT_CREDIT_ATTEMPT_EVENT,lifecycle);};
 },[]);
 const notice=state.notice;
 if (!notice) return null;
 return <aside role="alert" aria-label="模型使用提示" className="fixed bottom-6 right-6 z-50 max-w-md space-y-3 rounded-card border border-border bg-card p-4 shadow-lg"><CreditFailureDetails notice={notice} onDismiss={()=>dispatch({type:"dismiss"})}/></aside>;
}
