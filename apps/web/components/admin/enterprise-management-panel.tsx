"use client";
import * as React from "react";
import {EnterpriseCreditGrantRequest,type EnterpriseUpgradeOperation} from "@repo/contracts/billing-team";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {grantEnterpriseCredits,upgradeEnterprise} from "@/lib/live-enterprise-management";

export function EnterpriseManagementPanel({orgId,version,enterprise,onApplied}:{orgId:string;version:number;enterprise:boolean;onApplied:()=>void}){
 const [credits,setCredits]=React.useState("");const [reason,setReason]=React.useState("");
 const [busy,setBusy]=React.useState(false);const [message,setMessage]=React.useState("");
 const [operation,setOperation]=React.useState<EnterpriseUpgradeOperation|null>(null);
 // A network failure must retain the same request identity, including its parameters.
 const attempt=React.useRef<{kind:"grant"|"upgrade";key:string;version:number;credits:string;reason:string}|null>(null);
 const valid=EnterpriseCreditGrantRequest.safeParse({credits:Number(credits),reason,idempotencyKey:"validation-key-0001"}).success;
 async function submit(kind:"grant"|"upgrade"){
  if(busy)return;setBusy(true);setMessage("");
  if(!attempt.current)attempt.current={kind,key:crypto.randomUUID(),version,credits,reason};
  const request=attempt.current;
  try{
   if(request.kind==="grant"){
    const result=await grantEnterpriseCredits(orgId,{credits:Number(request.credits),reason:request.reason,idempotencyKey:request.key});
    setMessage(`已添加 ${result.credits.toLocaleString()} 额度，余额 ${result.balance.toLocaleString()}。审计编号：${result.auditRef}`);
    attempt.current=null;setCredits("");setReason("");onApplied();
   }else{
    const result=await upgradeEnterprise(orgId,{expectedPlanVersion:request.version,idempotencyKey:request.key});setOperation(result);
    if(result.status==="succeeded"){attempt.current=null;setMessage("已升级 Enterprise。原已付 Team 额度按原周期继续至到期。");onApplied();}
    else setMessage(result.status==="needs_review"?"升级需要平台复核，套餐尚未变更。":"升级处理中，套餐尚未变更。可重试原操作。");
   }
  }catch{setMessage("操作未确认完成。请重试原请求，避免重复添加额度。");}
  finally{setBusy(false);}
 }
 return <section aria-label="Enterprise 管理" className="my-4 space-y-3 rounded-lg border p-4">
  <h3 className="font-semibold">Enterprise</h3>
  <p className="text-13 text-muted-foreground">Enterprise 无 Team 收费席位上限。额度由平台人员手动添加，不产生默认月额度。已付 Team 额度按原购买日继续发放至原到期日。</p>
  {enterprise?<><label className="block">添加额度<Input type="number" min={1} max={1000000} step={1} value={credits} disabled={busy||attempt.current!==null} onChange={e=>setCredits(e.target.value)}/></label>
   <label className="block">添加原因<Input maxLength={500} value={reason} disabled={busy||attempt.current!==null} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={busy||(!attempt.current&&!valid)} onClick={()=>void submit("grant")}>{busy?"提交中…":attempt.current?"重试原请求":"添加额度"}</Button>
  </>:<Button disabled={busy||operation?.status==="needs_review"} onClick={()=>void submit("upgrade")}>{busy?"提交中…":operation?"重试原升级":"手动升级 Enterprise"}</Button>}
  {operation&&<p className="text-13">操作编号：{operation.operationRef}</p>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
