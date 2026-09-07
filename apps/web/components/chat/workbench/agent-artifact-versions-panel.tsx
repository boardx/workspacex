"use client";
import * as React from "react";
import Image from "next/image";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getAgentRun, isTerminalRunStatus } from "@/lib/agent-run";
import { continueAgentArtifact, diffArtifactLines, fetchArtifactContent, isTextArtifact, listAgentArtifacts,
  type AgentArtifact } from "@/lib/chat-workbench/agent-artifacts";

const PREVIEW_BYTES=256*1024;
export interface AgentArtifactVersionsPanelProps {
  readonly threadId: string; readonly projectId?: string | null; readonly sessionToken?: string;
  readonly refreshKey?: string | number;
  readonly canEdit?: boolean;
  readonly onRunStarted?: (runId: string) => void;
}
export function AgentArtifactVersionsPanel({threadId,projectId,sessionToken,refreshKey,onRunStarted,canEdit=false}:AgentArtifactVersionsPanelProps) {
  const [artifacts,setArtifacts]=React.useState<AgentArtifact[]>([]);
  const [loadedThreadId,setLoadedThreadId]=React.useState<string|null>(null);
  const inputId=React.useId();
  const currentThread=React.useRef(threadId);currentThread.current=threadId;
  const [artifactId,setArtifactId]=React.useState("");
  const [version,setVersion]=React.useState<number|null>(null);
  const [loading,setLoading]=React.useState(true),[error,setError]=React.useState<string|null>(null);
  const [reload,setReload]=React.useState(0),[instruction,setInstruction]=React.useState("");
  const [submitting,setSubmitting]=React.useState(false),[activeRun,setActiveRun]=React.useState<string|null>(null);
  const [runNotice,setRunNotice]=React.useState("");
  const requestRef=React.useRef<{signature:string;id:string}|null>(null);
  const latestOnRunStarted=React.useRef(onRunStarted);latestOnRunStarted.current=onRunStarted;
  const artifact=loadedThreadId===threadId?(artifacts.find(item=>item.artifactId===artifactId)??artifacts[0]):undefined;
  const selected=artifact?.versions.find(item=>item.version===version)??artifact?.versions.at(-1);

  React.useEffect(()=>{setArtifacts([]);setLoadedThreadId(null);setArtifactId("");setVersion(null);setInstruction("");setActiveRun(null);setRunNotice("");setSubmitting(false);requestRef.current=null;},[threadId]);
  React.useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError(null);
    void listAgentArtifacts(threadId,projectId,sessionToken,abort.signal).then(values=>{if(!abort.signal.aborted){setArtifacts(values);setLoadedThreadId(threadId);}})
      .catch(()=>{if(!abort.signal.aborted)setError("无法加载成果，请重试。");}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[threadId,projectId,sessionToken,refreshKey,reload]);
  React.useEffect(()=>{
    if(!activeRun)return;
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try{
        const run=await getAgentRun(activeRun,sessionToken,abort.signal);
        if(abort.signal.aborted)return;
        if(isTerminalRunStatus(run.status)){
          setActiveRun(null);
          if(run.status==="succeeded"){setRunNotice("新版本已生成。");setVersion(null);setInstruction("");requestRef.current=null;setReload(v=>v+1);}
          else {setRunNotice(run.status==="cancelled"?"修改已停止，旧版本保留。":"修改未完成，旧版本保留。");setError("可以调整要求后重新提交修改。");requestRef.current=null;}
          return;
        }
        setRunNotice(run.status==="paused"?"修改已暂停，请在任务中继续。":run.status==="awaiting_tool_permission"?"等待确认，请在任务中处理。":"正在生成新版本，原版本保持不变。");
        timer=setTimeout(()=>void poll(),1500);
      }catch{if(!abort.signal.aborted)setError("暂时无法读取修改进度，点击刷新继续查看。");}
    };void poll();return()=>{abort.abort();if(timer)clearTimeout(timer);};
  },[activeRun,sessionToken,reload]);

  async function submit(){
    if(!canEdit||!artifact||!selected||!instruction.trim()||submitting||activeRun)return;
    const signature=JSON.stringify([artifact.artifactId,selected.version,instruction]);
    if(requestRef.current?.signature!==signature)requestRef.current={signature,id:crypto.randomUUID()};
    const submittedThread=threadId;
    setSubmitting(true);setError(null);
    try{
      const result=await continueAgentArtifact(artifact.artifactId,selected.version,instruction,requestRef.current.id,sessionToken);
      if(currentThread.current!==submittedThread)return;
      setActiveRun(result.runId);setRunNotice("修改已受理，正在生成新版本。");latestOnRunStarted.current?.(result.runId);
    }catch{if(currentThread.current===submittedThread)setError("修改请求未确认，请重试。重试不会重复创建任务。");}
    finally{if(currentThread.current===submittedThread)setSubmitting(false);}
  }
  return <section className="min-w-0 space-y-3" aria-label="成果与版本" data-testid="agent-artifact-versions-panel">
    <div className="flex items-center justify-between gap-2"><h3 className="text-13 font-medium">成果与版本</h3>
      <Button variant="ghost" size="sm" aria-label="刷新成果与修改进度" onClick={()=>setReload(v=>v+1)}><RefreshCw className="h-4 w-4"/></Button></div>
    {loading&&<p role="status" data-testid="loading" className="flex items-center gap-2 text-13 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>正在读取成果…</p>}
    {error&&<div role="alert" data-testid="err-artifacts" className="rounded-container border border-border p-3 text-13">{error}<Button variant="ghost" size="sm" onClick={()=>setReload(v=>v+1)}>刷新</Button></div>}
    {!loading&&!artifacts.length&&!error&&<p data-testid="empty" className="rounded-container border border-dashed border-border p-4 text-13 text-muted-foreground">任务生成的文件会显示在这里，可查看历史版本并继续修改。</p>}
    {artifact&&selected&&<>
      <Select data-testid="artifact-picker" options={artifacts.map(item=>({value:item.artifactId,label:item.name}))} value={artifact.artifactId}
        onValueChange={id=>{setArtifactId(id);setVersion(null);}}/>
      <div className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground"/>
        <Select data-testid="artifact-version-picker" className="min-w-0 flex-1" options={[...artifact.versions].reverse().map(item=>({value:String(item.version),label:`版本 ${item.version}${item.basedOnVersion?` · 基于版本 ${item.basedOnVersion}`:""}`}))}
          value={String(selected.version)} onValueChange={value=>setVersion(Number(value))}/></div>
      <ArtifactPreview key={`${artifact.artifactId}:${selected.version}`} artifact={artifact} version={selected.version} sessionToken={sessionToken}/>
      <p className="line-clamp-3 text-11 text-muted-foreground" title={selected.changeNote}>{selected.changeNote}</p>
      {canEdit&&<div className="space-y-2"><Label htmlFor={inputId}>基于版本 {selected.version} 继续修改</Label>
        <Textarea id={inputId} data-testid="artifact-edit-instruction" value={instruction} onChange={event=>setInstruction(event.target.value)}
          placeholder="描述要修改的内容，例如：保留结构，精简结论。" disabled={submitting||!!activeRun}/>
        <Button data-testid="artifact-continue" size="sm" onClick={()=>void submit()} disabled={!instruction.trim()||submitting||!!activeRun}>
          {submitting?<Loader2 className="h-4 w-4 animate-spin"/>:null}{submitting?"正在提交…":"生成新版本"}</Button></div>}
    </>}
    {runNotice&&<p role="status" className="text-13 text-muted-foreground">{runNotice}</p>}
  </section>;
}

function ArtifactPreview({artifact,version,sessionToken}:{artifact:AgentArtifact;version:number;sessionToken?:string}) {
  const [blob,setBlob]=React.useState<Blob|null>(null),[url,setUrl]=React.useState<string|null>(null);
  const [text,setText]=React.useState<string|null>(null),[error,setError]=React.useState(false),[retry,setRetry]=React.useState(0);
  const compareAbort=React.useRef<AbortController|null>(null);
  React.useEffect(()=>()=>compareAbort.current?.abort(),[]);
  const [diff,setDiff]=React.useState<ReturnType<typeof diffArtifactLines>|null>(null),[diffBusy,setDiffBusy]=React.useState(false);
  const selected=artifact.versions.find(item=>item.version===version)!;
  const base=selected.basedOnVersion??artifact.versions.filter(item=>item.version<version).at(-1)?.version;
  React.useEffect(()=>{
    const abort=new AbortController();let objectUrl:string|null=null;setError(false);
    void fetchArtifactContent(artifact.artifactId,version,sessionToken,abort.signal).then(async value=>{
      if(abort.signal.aborted)return;setBlob(value);objectUrl=URL.createObjectURL(value);setUrl(objectUrl);
      if(isTextArtifact(artifact.name)){const valueText=await value.slice(0,PREVIEW_BYTES).text();if(!abort.signal.aborted)setText(valueText);}
    }).catch(()=>{if(!abort.signal.aborted)setError(true);});
    return()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[artifact.artifactId,artifact.name,version,sessionToken,retry]);
  async function compare(){
    if(!base||text===null)return;setDiffBusy(true);
    compareAbort.current?.abort();const abort=new AbortController();compareAbort.current=abort;
    try{
      const prior=await fetchArtifactContent(artifact.artifactId,base,sessionToken,abort.signal);
      const priorText=await prior.slice(0,PREVIEW_BYTES).text();
      if(!abort.signal.aborted){const result=diffArtifactLines(priorText,text);setDiff({...result,truncated:result.truncated||prior.size>PREVIEW_BYTES||!!blob&&blob.size>PREVIEW_BYTES});}
    }catch{if(!abort.signal.aborted)setError(true);}finally{if(!abort.signal.aborted)setDiffBusy(false);}
  }
  if(error)return <div role="alert" className="text-13">此版本暂时无法读取。<Button variant="ghost" size="sm" onClick={()=>setRetry(v=>v+1)}>重试预览</Button></div>;
  if(!url)return <p role="status" className="text-13 text-muted-foreground">正在读取版本…</p>;
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>{const anchor=document.createElement("a");anchor.href=url;anchor.download=artifact.name;anchor.click();}}><Download className="h-4 w-4"/>下载此版本</Button>
      {isTextArtifact(artifact.name)&&base&&<Button variant="ghost" size="sm" disabled={diffBusy} onClick={()=>void compare()}>与版本 {base} 比较</Button>}</div>
    {diff?<div data-testid="artifact-text-diff" className="max-h-64 overflow-auto rounded-container border border-border p-3 font-mono text-11">
      {diff.lines.map((line,index)=><div key={index} className="whitespace-pre-wrap break-all" aria-label={line.kind==="added"?"新增":line.kind==="removed"?"删除":"未变"}>{line.kind==="added"?"+ ":line.kind==="removed"?"− ":"  "}{line.text}</div>)}
      {diff.truncated&&<p className="font-sans text-muted-foreground">比较限于前 600 行及每版前 256 KB，完整内容请下载查看。</p>}</div>
      :text!==null?<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-container border border-border p-3 text-11">{text}</pre>
      :artifact.kind==="png"?<Image unoptimized src={url} width={1024} height={768} alt={`${artifact.name}，版本 ${version}`} className="max-h-64 w-full rounded-container object-contain"/>
      :artifact.kind==="pdf"?<iframe src={url} title={`${artifact.name}，版本 ${version}`} className="h-64 w-full rounded-container border border-border"/>
      :<p className="rounded-container border border-border p-3 text-13 text-muted-foreground">此格式可下载查看；历史版本均保留。</p>}
    {blob&&blob.size>PREVIEW_BYTES&&isTextArtifact(artifact.name)&&<p className="text-11 text-muted-foreground">预览仅显示前 256 KB，完整内容请下载。</p>}
  </div>;
}
