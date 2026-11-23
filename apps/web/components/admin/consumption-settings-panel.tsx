"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { z } from "zod";
import { operations } from "@repo/contracts/billing-consumption";
import { apiRequest, ApiError } from "@/lib/api-client";
import { NativeCreditTariffsPanel } from "./native-credit-tariffs-panel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
function formatOverride(value: number | null | undefined): string {
 return value == null ? "" : String(value / 10000);
}
export function ConsumptionSettingsPanel({ market }: { market?: "cn" | "us" } = {}) {
  const { t, locale } = useI18n();
 const isChinese = locale === "zh-CN";
 const [rate, setRate] = React.useState("");
 const [marketRates, setMarketRates] = React.useState<z.infer<typeof operations.getPlatformSettings.out>["marketRates"]>();
 const effectiveRate = market ? marketRates?.[market].effectiveBps : undefined;
 const [enabled,setEnabled]=React.useState<boolean|null>(null);
 const [fixedPolicy,setFixedPolicy]=React.useState(false);
 const [denied,setDenied]=React.useState(false);
 const [busy,setBusy]=React.useState(false);
 const [message,setMessage]=React.useState<"" | "platformOps.consumption.readFailed" | "platformOps.consumption.saved" | "platformOps.consumption.saveFailed">("");
 const [revision,retry]=React.useReducer((v:number)=>v+1,0);
 React.useEffect(()=>{const controller=new AbortController();setMessage("");void apiRequest(operations.getPlatformSettings.path,{signal:controller.signal}).then(raw=>{const value=operations.getPlatformSettings.out.parse(raw);if(!controller.signal.aborted){setEnabled(value.creditPreflightEnabled);setFixedPolicy(value.admissionPolicy!==undefined);setRate(formatOverride(market ? value.marketRates?.[market].overrideBps : undefined));setMarketRates(value.marketRates);}}).catch((error:unknown)=>{if(controller.signal.aborted)return;if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("platformOps.consumption.readFailed");});return()=>controller.abort();},[revision, market]);
 if(denied)return null;
 async function save(){if(enabled===null||busy)return;setBusy(true);setMessage("");try{const raw=await apiRequest(operations.updatePlatformSettings.path,{method:"PATCH",body:{creditPreflightEnabled:!enabled}});setEnabled(operations.updatePlatformSettings.out.parse(raw).creditPreflightEnabled);setMessage("platformOps.consumption.saved");}catch(error){if(error instanceof ApiError && [401,403].includes(error.status))setDenied(true);else setMessage("platformOps.consumption.saveFailed");}finally{setBusy(false);}}
 async function saveRate(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (busy || !market) return;
  setBusy(true);
  setMessage("");
  try {
   const body = operations.updatePlatformSettings.in.parse({ market, creditRateBps: rate.trim() ? Math.round(Number(rate) * 10000) : null });
   const updated = operations.updatePlatformSettings.out.parse(
    await apiRequest(operations.updatePlatformSettings.path, { method: "PATCH", body }),
   );
   setRate(formatOverride(updated.marketRates?.[market].overrideBps));
   setMarketRates(updated.marketRates);
   setMessage("platformOps.consumption.saved");
  } catch {
   setMessage("platformOps.consumption.saveFailed");
  } finally {
   setBusy(false);
  }
 }
 return <section className="space-y-3 rounded-card border border-border bg-card p-4" aria-label={t("platformOps.consumption.label")}><h2 className="text-14 font-semibold">{t("platformOps.consumption.title")}</h2>{fixedPolicy?<p className="text-13 text-muted-foreground">{t("platformOps.consumption.fixedPolicy")}</p>:<p className="text-13 text-muted-foreground">{t("platformOps.consumption.policy")}</p>}{enabled===null?<p role="status">{t("platformOps.consumption.loading")}</p>:!fixedPolicy&&<Button role="switch" aria-checked={enabled} aria-label={t("platformOps.consumption.toggle")} disabled={busy} variant="outline" onClick={()=>void save()}>{busy?t("platformOps.consumption.saving"):enabled?t("platformOps.consumption.on"):t("platformOps.consumption.off")}</Button>}{effectiveRate !== undefined && (
  <form onSubmit={saveRate} className="space-y-2 border-t border-border pt-3">
   <label className="grid gap-2 text-13">
    {isChinese ? "积分扣费倍率（×）" : "Credit usage multiplier (×)"}
    <Input type="number" min={0.0001} max={100} step={0.0001} value={rate}
      placeholder={isChinese ? "留空使用部署默认值" : "Leave blank to use the deployment default"}
      onChange={(event) => setRate(event.target.value)} disabled={busy} />
   </label>
   <p className="text-13 text-muted-foreground">
    {isChinese ? "当前生效倍率" : "Effective multiplier"} · {effectiveRate / 10000}×
   </p>
   <Button type="submit" variant="outline" disabled={busy}>{isChinese ? "保存倍率" : "Save multiplier"}</Button>
  </form>
 )}{message&&<p role="status" className="text-13">{t(message)}</p>}{enabled===null&&message&&<Button variant="outline" onClick={retry}>{t("platformOps.consumption.retry")}</Button>}{enabled!==null&&<NativeCreditTariffsPanel/>}</section>;
}
