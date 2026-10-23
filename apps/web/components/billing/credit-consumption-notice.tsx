"use client";
import * as React from "react";
import { creditGuidance, CREDIT_FAILURE_EVENT, type CreditGuidance } from "@/lib/credit-guidance";
import { Button } from "@/components/ui/button";
export function CreditConsumptionNotice() {
 const [notice,setNotice]=React.useState<CreditGuidance|null>(null);
 React.useEffect(()=>{const listener=(event:Event)=>setNotice(creditGuidance((event as CustomEvent).detail));window.addEventListener(CREDIT_FAILURE_EVENT,listener);return()=>window.removeEventListener(CREDIT_FAILURE_EVENT,listener);},[]);
 if (!notice) return null;
 return <aside role="alert" aria-label="模型使用提示" className="fixed bottom-6 right-6 z-50 max-w-md space-y-3 rounded-card border border-border bg-card p-4 shadow-lg">
 <p className="text-14">{notice.code === "credit_accounting_unavailable" ? "计费服务暂时不可用，本次请求未自动重试。请稍后重试或联系管理员。" : notice.rechargePath ? notice.ownerType === "team" ? "组织可用额度不足，请联系组织管理员充值；管理员可在新页面为组织充值。" : "可用额度不足，请充值后手动继续。" : "可用额度不足，请联系管理员确认本次任务的计费账户并充值。"}</p>
 <p className="text-12 text-muted-foreground">当前页面内容已保留，充值后不会自动重新执行任务。</p>
 <div className="flex gap-2">{notice.rechargePath && <Button asChild><a href={notice.rechargePath} target="_blank" rel="noopener noreferrer">{notice.ownerType === "team" ? "为组织充值" : "前往充值"}</a></Button>}<Button variant="outline" onClick={()=>setNotice(null)}>关闭提示</Button></div>
 </aside>;
}
