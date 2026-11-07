"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { operations } from "@repo/contracts/billing-consumption";
import { apiRequest, ApiError } from "@/lib/api-client";
import { NativeCreditTariffsPanel } from "./native-credit-tariffs-panel";
import { Button } from "@/components/ui/button";
export function ConsumptionSettingsPanel() {
  const { t } = useI18n();
 const [enabled,setEnabled]=React.useState<boolean|null>(null);
 const [fixedPolicy,setFixedPolicy]=React.useState(false);
 const [denied,setDenied]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [message,setMessage]=React.useState<"" | "platformOps.consumption.readFailed" | "platformOps.consumption.saved" | "platformOps.consumption.saveFailed">("");
 const [revision,retry]=React.useReducer((v:number)=>v+1,0);
 React.useEffect(()=>{const controller=new AbortController();setMessage("");void apiRequest(operations.getPlatformSettings.path,{signal:controller.signal}).then(raw=>{const value=operations.getPlatformSettings.out.parse(raw);if(!controller.signal.aborted){setEnabled(value.creditPreflightEnabled);setFixedPolicy(value.admissionPolicy!==undefined);}}).catch((error:unknown)=>{if(controller.signal.aborted)return;if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("platformOps.consumption.readFailed");});return()=>controller.abort();},[revision]);
 if(denied)return null;
 async function save(){if(enabled===null||busy)return;setBusy(true);setMessage("");try{const raw=await apiRequest(operations.updatePlatformSettings.path,{method:"PATCH",body:{creditPreflightEnabled:!enabled}});setEnabled(operations.updatePlatformSettings.out.parse(raw).creditPreflightEnabled);setMessage("platformOps.consumption.saved");}catch(error){if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("platformOps.consumption.saveFailed");}finally{setBusy(false);}}
 return <section className="space-y-3 rounded-card border border-border bg-card p-4" aria-label={t("platformOps.consumption.label")}><h2 className="text-14 font-semibold">{t("platformOps.consumption.title")}</h2>{fixedPolicy?<p className="text-13 text-muted-foreground">{t("platformOps.consumption.fixedPolicy")}</p>:<p className="text-13 text-muted-foreground">{t("platformOps.consumption.policy")}</p>}{enabled===null?<p role="status">{t("platformOps.consumption.loading")}</p>:!fixedPolicy&&<Button role="switch" aria-checked={enabled} aria-label={t("platformOps.consumption.toggle")} disabled={busy} variant="outline" onClick={()=>void save()}>{busy?t("platformOps.consumption.saving"):enabled?t("platformOps.consumption.on"):t("platformOps.consumption.off")}</Button>}{message&&<p role="status" className="text-13">{t(message)}</p>}{enabled===null&&message&&<Button variant="outline" onClick={retry}>{t("platformOps.consumption.retry")}</Button>}{enabled!==null&&<NativeCreditTariffsPanel/>}</section>;
}
