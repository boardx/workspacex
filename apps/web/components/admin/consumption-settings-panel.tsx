"use client";
import * as React from "react";
import { operations } from "@repo/contracts/billing-consumption";
import { apiRequest, ApiError } from "@/lib/api-client";
import { NativeCreditTariffsPanel } from "./native-credit-tariffs-panel";
import { Button } from "@/components/ui/button";
export function ConsumptionSettingsPanel() {
 const [enabled,setEnabled]=React.useState<boolean|null>(null);
 const [denied,setDenied]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [message,setMessage]=React.useState("");
 const [revision,retry]=React.useReducer((v:number)=>v+1,0);
 React.useEffect(()=>{const controller=new AbortController();setMessage("");void apiRequest(operations.getPlatformSettings.path,{signal:controller.signal}).then(raw=>{const value=operations.getPlatformSettings.out.parse(raw);if(!controller.signal.aborted)setEnabled(value.creditPreflightEnabled);}).catch((error:unknown)=>{if(controller.signal.aborted)return;if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("暂时无法读取消费设置，请重试。");});return()=>controller.abort();},[revision]);
 if(denied)return null;
 async function save(){if(enabled===null||busy)return;setBusy(true);setMessage("");try{const raw=await apiRequest(operations.updatePlatformSettings.path,{method:"PATCH",body:{creditPreflightEnabled:!enabled}});setEnabled(operations.updatePlatformSettings.out.parse(raw).creditPreflightEnabled);setMessage("设置已保存，仅对新的模型调用生效。");}catch(error){if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("设置未保存，仍沿用上次确认的状态。");}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-card border border-border bg-card p-4" aria-label="模型消费设置"><h2 className="text-14 font-semibold">模型消费设置 · 整个部署</h2><p className="text-13 text-muted-foreground">开启后，调用模型前必须有足够可用额度；额度不足时引导充值。关闭后仍记录用量与扣费，不足部分记录为待结算欠额。仅平台管理员可以修改。</p>{enabled===null?<p role="status">正在读取设置…</p>:<Button role="switch" aria-checked={enabled} aria-label="使用模型前验证可用额度" disabled={busy} variant="outline" onClick={()=>void save()}>{busy?"正在保存…":enabled?"前置额度验证：已开启":"前置额度验证：已关闭"}</Button>}{message&&<p role="status" className="text-13">{message}</p>}{enabled===null&&message&&<Button variant="outline" onClick={retry}>重试读取</Button>}{enabled!==null&&<NativeCreditTariffsPanel/>}</section>;
}
