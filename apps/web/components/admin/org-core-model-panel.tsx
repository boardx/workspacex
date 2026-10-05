"use client";
import * as React from "react";
import {SetInput} from "@repo/contracts/organization-core-model";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {ApiError} from "@/lib/api-client";
import {getOrgCoreModel,getOrgCoreModelCandidates,setOrgCoreModel,type OrgCoreModelState,type OrgCoreModelCandidate} from "@/lib/live-org-core-model";
function failureText(error:unknown):string {
 if(error instanceof ApiError){
  if(error.status===403)return "仅当前组织管理员可以设置核心模型。";
  if(error.status===401)return "登录状态已失效，请重新登录后再配置。";
  if(error.reasonCode==="CORE_MODEL_UNAVAILABLE")return "所选模型当前不可用，请刷新候选；你的草稿已保留。";
 }
 return "核心模型配置暂不可用，请重试；你的草稿已保留。";
}
const sameBinding=(state:NonNullable<OrgCoreModelState["selection"]>,candidate:OrgCoreModelCandidate)=>state.modelId===candidate.modelId&&state.modelProvider===candidate.modelProvider&&state.runtimeModelId===candidate.runtimeModelId&&state.configRevision===candidate.configRevision;
/** Selection is audited configuration only; it never tests or automatically activates a supplier. */
export function OrgCoreModelPanel({orgId}:{orgId:string}) {
 const activeOrg=React.useRef(orgId),generation=React.useRef(0),mounted=React.useRef(true),controller=React.useRef<AbortController|null>(null);
 if(activeOrg.current!==orgId){activeOrg.current=orgId;generation.current++;}
 const [loadedOrg,setLoadedOrg]=React.useState<string|null>(null),[state,setState]=React.useState<OrgCoreModelState|null>(null),[candidates,setCandidates]=React.useState<OrgCoreModelCandidate[]>([]);
 const [modelId,setModelId]=React.useState(""),[reason,setReason]=React.useState(""),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState<string|null>(null),[readFailed,setReadFailed]=React.useState(false),[conflict,setConflict]=React.useState(false),[saved,setSaved]=React.useState(false);
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
  }catch(cause){if(ownsResponse()){setError(failureText(cause));setReadFailed(true);}}
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
   setConflict(changed);setError(changed?"配置已被其他管理员修改。请刷新最新版本，你的模型选择和变更理由会保留。":failureText(cause));
   if(cause instanceof ApiError&&(cause.status===401||cause.status===403))setReadFailed(true);
   if(cause instanceof ApiError&&cause.reasonCode==="CORE_MODEL_UNAVAILABLE")setCandidates(rows=>rows.map(row=>row.modelId===modelId?{...row,available:false,reason:"CORE_MODEL_UNAVAILABLE"}:row));
  }}finally{if(ownsResponse())setBusy(false);}
 }
 return <section aria-label="组织核心模型" className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground" data-testid="org-core-model-panel">
  <div className="space-y-2"><h2 className="text-16 font-semibold">组织核心模型</h2><p className="text-13 text-muted-foreground">仅新默认助手调用继承核心模型；已运行任务与其他 Agent 的显式模型选择保持不变。</p><p className="text-13 text-muted-foreground">保存选择不会测试模型或启用供应商。目录收录不代表账号可用，费用与安全上限继续生效。</p></div>
  {loading&&<p role="status" data-testid="loading">正在读取当前组织的配置与可用候选…</p>}
  {error&&<p role="alert" className="text-13 text-destructive" data-testid="err-core-model">{error}</p>}
  {saved&&<p role="status" className="text-13">核心模型选择已保存，变更理由已记录。</p>}
  <Button variant="outline" disabled={busy||loading} onClick={()=>void load(true)}>{conflict?"刷新并保留草稿":"刷新配置与候选"}</Button>
  {visibleState&&!readFailed&&<>
   <div className="space-y-1 rounded-lg border border-border p-3">
    <p className="text-14 font-medium">{visibleState.selection?`当前核心模型：${configuredCandidate?.displayName??visibleState.selection.modelId}`:"核心模型未配置"}</p>
    <p className="text-13 text-muted-foreground">配置版本 {visibleState.version}</p>
    {visibleState.selection&&!configuredCandidate&&!loading&&<p role="status" className="text-13 text-destructive">当前配置不可用，或部署配置已变化。请重新选择已验证的候选；系统不会自动替换。</p>}
    {visibleState.updatedBy&&<p className="text-13 text-muted-foreground">最近修改人：{visibleState.updatedBy}</p>}
    {visibleState.reason&&<p className="break-words text-13 text-muted-foreground">最近变更理由：{visibleState.reason}</p>}
   </div>
   <fieldset className="min-w-0 space-y-3"><legend className="text-14 font-medium">选择已验证的组织正式模型</legend>
    {!candidates.length&&!loading&&<p data-testid="empty" className="text-13 text-muted-foreground">暂无候选。请先完成组织正式模型准入、部署绑定与计费配置，然后刷新。</p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">{candidates.map(candidate=><div key={candidate.modelId} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-14 font-medium">{candidate.displayName}</span><Badge>{candidate.available?"可选择":"不可选择"}</Badge></div>
     <p className="break-words text-13 text-muted-foreground">路由：{candidate.modelProvider??"未配置"} · 实际模型：{candidate.runtimeModelId??"未配置"}</p>
     {!candidate.available&&<p className="text-13 text-muted-foreground">{candidate.reason?"此模型未通过当前部署与计费验证，暂不可选择。":"可用性尚未验证，暂不可选择。"}</p>}
     <Button variant={modelId===candidate.modelId?"primary":"outline"} className="w-full" disabled={busy||loading||!candidate.available} aria-pressed={modelId===candidate.modelId} onClick={()=>{setModelId(candidate.modelId);setSaved(false);}}>选择 {candidate.displayName}</Button>
    </div>)}</div>
   </fieldset>
   {modelId&&<p className="break-words text-13">草稿选择：{selectedCandidate?.displayName??modelId}{!selectedCandidate?.available?"（当前不可用，请重新选择）":""}</p>}
   <div className="space-y-2"><Label htmlFor={reasonId}>变更理由（写入审计）</Label><Textarea id={reasonId} value={reason} maxLength={500} disabled={busy||loading} onChange={event=>{setReason(event.target.value);setSaved(false);}} placeholder="说明为什么选择此模型"/></div>
   <Button disabled={!canSave} onClick={()=>void save()}>{busy?"保存中…":"保存核心模型选择"}</Button>
  </>}
 </section>;
}
