"use client";
import * as React from "react";
import {SetInput} from "@repo/contracts/organization-core-model";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {ApiError} from "@/lib/api-client";
import {useI18n} from "@/lib/i18n/provider";
import {getOrgCoreModel,getOrgCoreModelCandidates,setOrgCoreModel,type OrgCoreModelState,type OrgCoreModelCandidate} from "@/lib/live-org-core-model";
function failureKey(error:unknown) {
 if(error instanceof ApiError){
  if(error.status===403)return "core.adminError" as const;
  if(error.status===401)return "core.sessionError" as const;
  if(error.reasonCode==="CORE_MODEL_UNAVAILABLE")return "core.unavailableError" as const;
 }
 return "core.genericError" as const;
}
const sameBinding=(state:NonNullable<OrgCoreModelState["selection"]>,candidate:OrgCoreModelCandidate)=>state.modelId===candidate.modelId&&state.modelProvider===candidate.modelProvider&&state.runtimeModelId===candidate.runtimeModelId&&state.configRevision===candidate.configRevision;
/** Selection is audited configuration only; it never tests or automatically activates a supplier. */
export function OrgCoreModelPanel({orgId}:{orgId:string}) {
 const {t}=useI18n();
 const activeOrg=React.useRef(orgId),generation=React.useRef(0),mounted=React.useRef(true),controller=React.useRef<AbortController|null>(null);
 if(activeOrg.current!==orgId){activeOrg.current=orgId;generation.current++;}
 const [loadedOrg,setLoadedOrg]=React.useState<string|null>(null),[state,setState]=React.useState<OrgCoreModelState|null>(null),[candidates,setCandidates]=React.useState<OrgCoreModelCandidate[]>([]);
 const [modelId,setModelId]=React.useState(""),[reason,setReason]=React.useState(""),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState<ReturnType<typeof failureKey>|"core.conflict"|null>(null),[readFailed,setReadFailed]=React.useState(false),[conflict,setConflict]=React.useState(false),[saved,setSaved]=React.useState(false);
 const reasonId=React.useId();
 const abortCurrentLoad=React.useCallback(()=>controller.current?.abort(),[]);
 const load=React.useCallback(async(preserveDraft:boolean)=>{
  controller.current?.abort();const requestController=new AbortController();controller.current=requestController;
  const requestGeneration=++generation.current,requestOrg=orgId;
  const ownsResponse=()=>mounted.current&&activeOrg.current===requestOrg&&generation.current===requestGeneration;
  setLoading(true);setError(null);setReadFailed(false);setSaved(false);
  try{
   const [current,options]=await Promise.all([getOrgCoreModel(requestController.signal),getOrgCoreModelCandidates(requestController.signal)]);
   if(!ownsResponse())return;
   setState(current);setCandidates(options);setLoadedOrg(requestOrg);setConflict(false);
   if(!preserveDraft){setModelId(current.selection?.modelId??"");setReason("");}
  }catch(cause){if(ownsResponse()){setError(failureKey(cause));setReadFailed(true);}}
  finally{if(ownsResponse())setLoading(false);}
 },[orgId]);
 React.useEffect(()=>{
  mounted.current=true;setLoadedOrg(null);setState(null);setCandidates([]);setModelId("");setReason("");setBusy(false);setConflict(false);
  void load(false);
  return ()=>{mounted.current=false;abortCurrentLoad();};
 },[load,abortCurrentLoad]);
 const visibleState=loadedOrg===orgId?state:null;
 const selectedCandidate=candidates.find(candidate=>candidate.modelId===modelId);
 const configuredCandidate=visibleState?.selection?candidates.find(candidate=>candidate.available&&sameBinding(visibleState.selection!,candidate)):undefined;
 const parsed=SetInput.safeParse({expectedVersion:visibleState?.version,modelId,reason});
 const canSave=!!visibleState&&parsed.success&&selectedCandidate?.available===true&&!busy&&!loading&&!readFailed&&!conflict;
 async function save(){
  if(!canSave||!parsed.success)return;
  const requestGeneration=generation.current,requestOrg=orgId;
  const ownsResponse=()=>mounted.current&&activeOrg.current===requestOrg&&generation.current===requestGeneration;
  setBusy(true);setError(null);setSaved(false);
  try{const updated=await setOrgCoreModel(parsed.data);if(ownsResponse()){setState(updated);setReason("");setSaved(true);}}
  catch(cause){if(ownsResponse()){
   const changed=cause instanceof ApiError&&(cause.status===409||cause.reasonCode==="VERSION_CHANGED");
   setConflict(changed);setError(changed?"core.conflict":failureKey(cause));
   if(cause instanceof ApiError&&(cause.status===401||cause.status===403))setReadFailed(true);
   if(cause instanceof ApiError&&cause.reasonCode==="CORE_MODEL_UNAVAILABLE")setCandidates(rows=>rows.map(row=>row.modelId===modelId?{...row,available:false,reason:"CORE_MODEL_UNAVAILABLE"}:row));
  }}finally{if(ownsResponse())setBusy(false);}
 }
 return <section aria-label={t("core.title")} className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="org-core-model-panel">
  <div className="space-y-2"><h2 className="text-16 font-semibold">{t("core.title")}</h2><p className="text-13 text-muted-foreground">{t("core.intro")}</p><p className="text-13 text-muted-foreground">{t("core.warning")}</p></div>
  {loading&&<p role="status" data-testid="loading">{t("core.loading")}</p>}
  {error&&<p role="alert" className="text-13 text-destructive" data-testid="err-core-model">{t(error)}</p>}
  {saved&&<p role="status" className="text-13">{t("core.saved")}</p>}
  <Button variant="outline" disabled={busy||loading} onClick={()=>void load(true)}>{t(conflict?"core.refreshDraft":"core.refresh")}</Button>
  {visibleState&&!readFailed&&<>
   <div className="space-y-1 rounded-lg border border-border p-3">
    <p className="text-14 font-medium">{visibleState.selection?t("core.current",{name:configuredCandidate?.displayName??visibleState.selection.modelId}):t("core.unconfigured")}</p>
    <p className="text-13 text-muted-foreground">{t("core.version",{version:visibleState.version})}</p>
    {visibleState.selection&&!configuredCandidate&&!loading&&<p role="status" className="text-13 text-destructive">{t("core.changed")}</p>}
    {visibleState.updatedBy&&<p className="text-13 text-muted-foreground">{t("core.updatedBy",{name:visibleState.updatedBy})}</p>}
    {visibleState.reason&&<p className="break-words text-13 text-muted-foreground">{t("core.lastReason",{reason:visibleState.reason})}</p>}
   </div>
   <fieldset className="min-w-0 space-y-3"><legend className="text-14 font-medium">{t("core.choose")}</legend>
    {!candidates.length&&!loading&&<p data-testid="empty" className="text-13 text-muted-foreground">{t("core.empty")}</p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">{candidates.map(candidate=><div key={candidate.modelId} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-14 font-medium">{candidate.displayName}</span><Badge>{t(candidate.available?"core.available":"core.unavailable")}</Badge></div>
     <p className="break-words text-13 text-muted-foreground">{t("core.route",{provider:candidate.modelProvider??t("core.notConfigured"),model:candidate.runtimeModelId??t("core.notConfigured")})}</p>
     {!candidate.available&&<p className="text-13 text-muted-foreground">{t(candidate.reason?"core.notVerified":"core.unverified")}</p>}
     <Button variant={modelId===candidate.modelId?"primary":"outline"} className="w-full" disabled={busy||loading||!candidate.available} aria-pressed={modelId===candidate.modelId} onClick={()=>{setModelId(candidate.modelId);setSaved(false);}}>{t("core.select",{name:candidate.displayName})}</Button>
    </div>)}</div>
   </fieldset>
   {modelId&&<p className="break-words text-13">{t("core.draft",{name:selectedCandidate?.displayName??modelId})}{!selectedCandidate?.available?t("core.draftUnavailable"):""}</p>}
   <div className="space-y-2"><Label htmlFor={reasonId}>{t("core.reason")}</Label><Textarea id={reasonId} value={reason} maxLength={500} disabled={busy||loading} onChange={event=>{setReason(event.target.value);setSaved(false);}} placeholder={t("core.reasonPlaceholder")}/></div>
   <Button disabled={!canSave} onClick={()=>void save()}>{t(busy?"core.saving":"core.save")}</Button>
  </>}
 </section>;
}
