"use client";
import * as React from "react";
import {Configuration} from "@repo/contracts/ai-policy";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ApiError} from "@/lib/api-client";
import {getPlatformAiPolicy,getPlatformAiCandidates,setPlatformAiPolicy,type AiPolicyState,type AiCandidate} from "@/lib/live-platform-organizations";
type PriceDraft={modelId:string;billingMode:"input-output"|"input-only";modelProvider:string;runtimeModelId:string;inputMicrosPerMillion:string;outputMicrosPerMillion:string;cachedInputMicrosPerMillion:string;maxInputTokens:string;maxOutputTokens:string;};
const emptyPrice=(modelId:string):PriceDraft=>({modelId,billingMode:"input-output",modelProvider:"",runtimeModelId:"",inputMicrosPerMillion:"",outputMicrosPerMillion:"",cachedInputMicrosPerMillion:"",maxInputTokens:"",maxOutputTokens:""});
function errorText(error:unknown){
 if(error instanceof ApiError){
  if(error.status===403)return "仅平台运营人员可以配置额度。";
  if(error.reasonCode==="AI_POLICY_VERSION_CONFLICT")return "配置已被修改，请刷新后重新提交。";
  if(error.reasonCode==="AI_POLICY_WINDOW_LOCKED")return "该时间范围已有预算窗口，不能重置，请配置不重叠的新窗口。";
  if(error.reasonCode==="AI_POLICY_MODEL_UNAVAILABLE")return "模型不再可用，或输入与输出上限超出其上下文，请刷新候选模型。";
 }
 return "额度配置暂不可用，请稍后重试。";
}
/** Operator configuration is explicit and audited; saving never enables admission. */
export function AiPolicyPanel({orgId}:{orgId:string}){
 const currentOrg=React.useRef(orgId),mounted=React.useRef(true),generation=React.useRef(0);
 if(currentOrg.current!==orgId){currentOrg.current=orgId;generation.current++;}
 React.useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
 const [state,setState]=React.useState<AiPolicyState|null>(null),[candidates,setCandidates]=React.useState<AiCandidate[]>([]);
 const [start,setStart]=React.useState(""),[end,setEnd]=React.useState(""),[timezone,setTimezone]=React.useState("");
 const [tokens,setTokens]=React.useState(""),[cost,setCost]=React.useState(""),[currency,setCurrency]=React.useState("");
 const [enforceRules,setEnforceRules]=React.useState<boolean|undefined>(undefined);
 const [controls,setControls]=React.useState(false),[quotaSource,setQuotaSource]=React.useState<"organization-template"|"member-monthly-utc">("organization-template"),[warning,setWarning]=React.useState(""),[degrade,setDegrade]=React.useState(""),[overrides,setOverrides]=React.useState<{userId:string;tokens:string}[]>([]);
 const [prices,setPrices]=React.useState<PriceDraft[]>([]),[fallback,setFallback]=React.useState<string[]>([]),[attempts,setAttempts]=React.useState("");
 const [reason,setReason]=React.useState(""),[busy,setBusy]=React.useState(false),[error,setError]=React.useState<string|null>(null),[refresh,setRefresh]=React.useState(0),[saved,setSaved]=React.useState(false);
 React.useEffect(()=>{
  let active=true;generation.current++;setState(null);setError(null);setSaved(false);setBusy(false);
  void Promise.all([getPlatformAiPolicy(orgId),getPlatformAiCandidates(orgId)]).then(([policy,models])=>{
   if(!active)return;setState(policy);setCandidates(models);setReason("");
   const config=policy.configuration;
   setStart(config?.window.start??"");setEnd(config?.window.end??"");setTimezone(config?.window.timezone??"");
   setTokens(config?.ordinaryTokensPerUser??"");setCost(config?.costMicrosPerUser??"");setCurrency(config?.currency??"");
   setPrices(config?.prices.map(row=>({...emptyPrice(row.modelId),...Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value)]))}) as PriceDraft)??[]);
   setEnforceRules(config?.tokenControls?.enforceLimitRules);setControls(!!config?.tokenControls);setQuotaSource(config?.tokenControls?.quotaSource??"organization-template");setWarning(config?.tokenControls?.warningAtTokens??"");setDegrade(config?.tokenControls?.degradeAtTokens??"");setOverrides(config?.tokenControls?.memberOverrides??[]);
   setFallback(config?.fallbackModelIds??[]);setAttempts(config?String(config.maxAttempts):"");
  }).catch(cause=>{if(active)setError(errorText(cause));});
  return ()=>{active=false;};
 },[orgId,refresh]);
 const parsed=Configuration.safeParse({...controls?{tokenControls:{...enforceRules===undefined?{}:{enforceLimitRules:enforceRules},quotaSource,warningAtTokens:warning||null,degradeAtTokens:degrade||null,memberOverrides:overrides}}:{},window:{start,end,timezone},ordinaryTokensPerUser:tokens||null,costMicrosPerUser:cost,currency,
  prices:prices.map(({billingMode,outputMicrosPerMillion,maxOutputTokens,...row})=>billingMode==="input-only"?{...row,billingMode,maxInputTokens:Number(row.maxInputTokens)}:{...row,outputMicrosPerMillion,maxInputTokens:Number(row.maxInputTokens),maxOutputTokens:Number(maxOutputTokens)}),fallbackModelIds:fallback,maxAttempts:Number(attempts)});
 async function save(){
  if(!state||!parsed.success||!reason.trim()||busy)return;setBusy(true);setError(null);setSaved(false);
  const ownerOrg=orgId,ownerGeneration=generation.current;
  const ownsResponse=()=>mounted.current&&currentOrg.current===ownerOrg&&generation.current===ownerGeneration;
  try{const updated=await setPlatformAiPolicy(orgId,{expectedVersion:state.version,reason:reason.trim(),configuration:parsed.data});if(ownsResponse()){setState(updated);setReason("");setSaved(true);}}
  catch(cause){if(ownsResponse())setError(errorText(cause));}finally{if(ownsResponse())setBusy(false);}
 }
 const field=(id:string,label:string,value:string,onChange:(value:string)=>void)=><label className="block space-y-1" key={id} htmlFor={id}>{label}<Input id={id} value={value} disabled={busy} onChange={event=>onChange(event.target.value)} /></label>;
 return <section aria-label="AI额度配置" className="my-4 space-y-3 rounded-lg border p-4">
  <h3 className="font-semibold">AI 额度与安全配置</h3>
  <p className="text-13 text-muted-foreground">保存配置不会自动启用限额。普通用户按每人额度计量；企业只豁免产品 Token 配额，仍需要有限费用与安全上限。</p>
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  {saved&&<p role="status">配置已保存，限制尚未启用。</p>}
  {!state&&!error&&<p role="status">正在加载额度配置…</p>}
  <Button variant="outline" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>刷新配置与候选</Button>
  {state&&<>
   <p>配置：{state.configuration?`已配置 · 版本 ${state.version}`:"未配置"} · 限制尚未启用</p>
   <div className="grid gap-3 md:grid-cols-2">
    {field("ai-window-start","窗口开始（含边界，ISO 时间与偏移）",start,setStart)}
    {field("ai-window-end","窗口结束（不含边界，ISO 时间与偏移）",end,setEnd)}
    {field("ai-window-zone","窗口时区（IANA 名称）",timezone,setTimezone)}
    {field("ai-token-limit","普通用户每人 Token 上限（空白表示未配置）",tokens,setTokens)}
    {field("ai-cost-limit","每人费用上限（整数微货币单位，1 单位货币 = 100万微单位）",cost,setCost)}
    {field("ai-currency","货币（三位大写代码）",currency,setCurrency)}
   </div>
   <fieldset className="space-y-3 rounded border p-3"><legend>Token 策略</legend>
    <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={controls} onChange={event=>setControls(event.target.checked)}/>显式配置阈值与成员额度来源</label>
    {!controls&&<p>未配置额外阈值；保留组织模板额度，不自动启用预警或降级。</p>}
    {controls&&<>
     <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={enforceRules===true} onChange={event=>setEnforceRules(event.target.checked)}/>执行已有组织 Token 规则</label>
     <p>仅显式启用后执行已有组织 Token 规则，不自动添加旧阈值。企业仍豁免产品 Token 配额，有限费用与安全上限继续生效；保存不会启用生产限制。</p>
     <label htmlFor="ai-quota-source">额度来源<select id="ai-quota-source" className="block rounded border bg-background p-2" disabled={busy} value={quotaSource} onChange={event=>{setQuotaSource(event.target.value as typeof quotaSource);if(event.target.value==="member-monthly-utc")setOverrides([]);}}>
      <option value="organization-template">组织模板与显式逐人覆盖</option><option value="member-monthly-utc">已有成员额度（UTC 自然月）</option>
     </select></label>
     <p>0 表示零额度；空白阈值表示未配置。企业豁免产品 Token 配额，费用硬上限仍生效。</p>
     {quotaSource==="member-monthly-utc"&&<p>使用已有成员额度作为唯一 Token 额度来源，不修改原额度，不使用模板逐人覆盖。窗口必须为完整 UTC 自然月；成员未配置额度时拒绝准入。</p>}
     {field("ai-warning-tokens","预警阈值（Token，空白表示未配置）",warning,setWarning)}
     {field("ai-degrade-tokens","降级阈值（Token，空白表示未配置）",degrade,setDegrade)}
     <p>降级仅限已授权且路由合规的候选，不能绕过 Token 或费用硬上限；配置保存不代表实际调用已启用。</p>
     {quotaSource==="organization-template"&&<>
      {overrides.map((row,index)=><fieldset key={index} className="space-y-2 rounded border p-2"><legend>成员覆盖 {index+1}</legend>
       {field(`ai-member-${index}`,`成员用户 ID ${index+1}`,row.userId,value=>setOverrides(rows=>rows.map((item,i)=>i===index?{...item,userId:value}:item)))}
       {field(`ai-member-tokens-${index}`,`成员 Token 上限 ${index+1}（0 表示零额度）`,row.tokens,value=>setOverrides(rows=>rows.map((item,i)=>i===index?{...item,tokens:value}:item)))}
       <Button variant="outline" disabled={busy} onClick={()=>setOverrides(rows=>rows.filter((_,i)=>i!==index))}>移除成员覆盖 {index+1}</Button>
      </fieldset>)}
      <Button variant="outline" disabled={busy||overrides.length>=500} onClick={()=>setOverrides(rows=>[...rows,{userId:"",tokens:""}])}>添加成员覆盖</Button>
     </>}
    </>}
    <p>预算窗口建立后额度快照不可修改；本窗口额度变更会被拒绝，请为不重叠的新窗口配置。</p>
   </fieldset>
   <p className="text-13">仅选择组织正式池中已启用的单模型；显示候选不代表其路由、价格或安全能力已通过运行时验证。</p>
   {candidates.length===0&&<p>没有可配置的模型，请先在组织正式模型池完成准入。</p>}
   {candidates.map(model=><label className="mr-4 inline-flex items-center gap-2" key={model.modelId}>
    <input type="checkbox" disabled={busy} checked={prices.some(row=>row.modelId===model.modelId)} onChange={event=>{
     if(event.target.checked)setPrices(rows=>[...rows,emptyPrice(model.modelId)]);
     else{setPrices(rows=>rows.filter(row=>row.modelId!==model.modelId));setFallback(ids=>ids.filter(id=>id!==model.modelId));}
    }}/>{model.displayName} · {model.contextWindow} Token
   </label>)}
   {prices.map(row=><fieldset key={row.modelId} className="space-y-2 rounded border p-3"><legend>{candidates.find(model=>model.modelId===row.modelId)?.displayName??row.modelId}</legend>
    <label htmlFor={`billing-${row.modelId}`}>计费方式<select id={`billing-${row.modelId}`} className="block rounded border bg-background p-2" disabled={busy} value={row.billingMode} onChange={event=>setPrices(rows=>rows.map(item=>item.modelId===row.modelId?{...item,billingMode:event.target.value as PriceDraft["billingMode"]}:item))}>
     <option value="input-output">输入与输出 Token</option><option value="input-only">仅输入 Token</option>
    </select></label>
    {row.billingMode==="input-only"&&<p className="text-13 text-muted-foreground">仅输入计费需验证供应商实际计量；保存此配置不会启用模型调用。</p>}
    <div className="grid gap-2 md:grid-cols-3">{([
     ["runtimeModelId","供应商实际模型标识（需验证，不从名称推断）"],["inputMicrosPerMillion","输入价格（微货币/百万 Token）"],["outputMicrosPerMillion","输出价格（微货币/百万 Token）"],
     ["cachedInputMicrosPerMillion","缓存输入价格（微货币/百万 Token）"],["maxInputTokens","单次输入安全上限（Token）"],["maxOutputTokens","单次输出安全上限（Token）"],
    ] as const).filter(([key])=>row.billingMode!=="input-only"||(key!=="outputMicrosPerMillion"&&key!=="maxOutputTokens")).map(([key,label])=>field(`price-${row.modelId}-${key}`,label,row[key],value=>setPrices(rows=>rows.map(item=>item.modelId===row.modelId?{...item,[key]:value}:item))))}
     <label htmlFor={`provider-${row.modelId}`}>已注册模型路由<select id={`provider-${row.modelId}`} className="block rounded border bg-background p-2" disabled={busy} value={row.modelProvider} onChange={event=>setPrices(rows=>rows.map(item=>item.modelId===row.modelId?{...item,modelProvider:event.target.value}:item))}>
      <option value="">请选择</option>{candidates.find(model=>model.modelId===row.modelId)?.modelProviders.map(provider=><option key={provider} value={provider}>{provider}</option>)}
     </select></label></div>
    <label className="flex items-center gap-2"><input type="checkbox" disabled={busy||(!fallback.includes(row.modelId)&&fallback.length>=4)} checked={fallback.includes(row.modelId)} onChange={event=>setFallback(ids=>event.target.checked?[...ids,row.modelId]:ids.filter(id=>id!==row.modelId))}/>允许作为后备模型</label>
   </fieldset>)}
   <p>后备顺序（主模型不重复调用）：{fallback.length?fallback.join(" → "):"无后备，不自动降级"}</p>
   {field("ai-max-attempts","一次调用最多尝试次数（含主模型，1–5）",attempts,setAttempts)}
   {field("ai-policy-reason","变更理由（写入审计）",reason,setReason)}
   <Button disabled={busy||!parsed.success||!reason.trim()} onClick={()=>void save()}>{busy?"保存中…":"保存额度配置"}</Button>
   {!parsed.success&&<p className="text-13 text-muted-foreground">请填写完整窗口、费用、模型价格和上限；后备次数不能超过已授权候选。</p>}
   <ul>{state.changes.map(change=><li key={change.version} className="text-13">版本 {change.version} · {change.actorId} · {change.reason}</li>)}</ul>
  </>}
 </section>;
}
