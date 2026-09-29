'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { SURVEY_PROPOSAL_FILE_MAX_BYTES,SurveyMarkdownProposalSchema,type SurveyMarkdownProposal } from '@repo/contracts/survey-markdown-proposal';
import { parseSurveyDesignMarkdown } from '@repo/contracts/survey-source';
import { surveyRequest } from '@/lib/survey/runtime-client';
import { listPersonalTranscriptions,type PersonalTranscriptionSummary } from '@/lib/live-personal-transcriptions';
export function SurveyAiProposal({locked,onApply,storageKey}:{locked:boolean;onApply:(markdown:string)=>void|Promise<void>;storageKey?:string}) {
  const [text,setText]=React.useState('');const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState('');
  const [proposal,setProposal]=React.useState<SurveyMarkdownProposal|null>(null);const [markdown,setMarkdown]=React.useState('');
  const [transcriptionId,setTranscriptionId]=React.useState('');
  const [file,setFile]=React.useState<{name:string;base64:string}|null>(null);
  const [reading,setReading]=React.useState(false);
  const [recordings,setRecordings]=React.useState<PersonalTranscriptionSummary[]|null>(null);
  const [recordingName,setRecordingName]=React.useState('');
  const [applying,setApplying]=React.useState(false);
  React.useEffect(()=>{
    if(!storageKey)return;
    try {const saved=window.sessionStorage.getItem(storageKey);if(!saved)return;
      const value=JSON.parse(saved) as {text?:string;markdown?:string;proposal?:unknown};
      if(typeof value.text==='string')setText(value.text);
      if(typeof value.markdown==='string')setMarkdown(value.markdown);
      const valid=SurveyMarkdownProposalSchema.safeParse(value.proposal);
      if(valid.success)setProposal(valid.data);
    } catch { /* A malformed browser draft must not block a new import. */ }
  },[storageKey]);
  React.useEffect(()=>{
    if(!storageKey||!proposal)return;
    window.sessionStorage.setItem(storageKey,JSON.stringify({text,markdown,proposal}));
  },[storageKey,text,markdown,proposal]);
  async function chooseRecording(){
    const id=revision.current;setError('');
    try{const page=await listPersonalTranscriptions();if(id===revision.current)setRecordings(page.items.filter(item=>item.status==='idle'));}
    catch{if(id===revision.current)setError('无法加载已保存录音，请重试。');}
  }
  const fileRevision=React.useRef(0);
  function upload(selected:File|undefined){
    const version=++fileRevision.current;setFile(null);setError('');setReading(false);setTranscriptionId('');setRecordingName('');
    if(!selected)return;
    if(selected.size>SURVEY_PROPOSAL_FILE_MAX_BYTES){setError('文件不能超过 256 KB。');return;}
    setReading(true);const reader=new FileReader();reader.onload=()=>{if(version!==fileRevision.current)return;setReading(false);
      const result=String(reader.result);setFile({name:selected.name,base64:result.slice(result.indexOf(',')+1)});setTranscriptionId('');};
    reader.onerror=()=>{if(version===fileRevision.current){setReading(false);setError('文件读取失败，请重新选择。');}};reader.readAsDataURL(selected);
  }
  const revision=React.useRef(0);const abort=React.useRef<AbortController|null>(null);
  function cancel(){revision.current++;abort.current?.abort();setBusy(false);}
  React.useEffect(()=>()=>{revision.current++;fileRevision.current++;abort.current?.abort();},[]);
  async function generate(){
    const id=++revision.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError('');
    try{const result=await surveyRequest('/surveys/markdown-proposals',{method:'POST',body:{text,...(transcriptionId?{transcriptionId}: {}),...(file?{file}: {})},signal:controller.signal},SurveyMarkdownProposalSchema);
      if(id!==revision.current||controller.signal.aborted)return;setProposal(result);setMarkdown(result.markdown);
    }catch{if(id===revision.current&&!controller.signal.aborted)setError('生成失败，请检查输入或模型配置后重试。原问卷未改变。');}
    finally{if(id===revision.current)setBusy(false);}
  }
  const parsed=parseSurveyDesignMarkdown(markdown);
  if(locked)return null;
  return <section aria-label="AI 问卷生成" className="mx-auto mb-4 max-w-6xl space-y-3 rounded-lg border border-border bg-card p-5">
    <h2 className="text-16 font-semibold">AI 智能生成问卷</h2>
    <p className="text-12 text-muted-foreground">描述目标与受众，AI 先生成 Markdown 提案，校对后再应用。不会自动发布。</p>
    <textarea aria-label="问卷需求" maxLength={20000} disabled={busy} value={text} onChange={event=>setText(event.target.value)} className="min-h-32 w-full rounded-md border border-border bg-background p-3 text-13" placeholder="研究目的、目标受众、关注内容、题型偏好…"/>
    <label className="block text-13">上传文件<input aria-label="上传问卷文件" type="file" accept=".md,.markdown,.txt,.pdf,.docx" disabled={busy} onChange={event=>upload(event.target.files?.[0])} className="ml-2"/></label>
    <p className="text-12 text-muted-foreground">支持 Markdown、TXT、PDF、Word（DOCX），最多 256 KB。{file?.name}</p>
    <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy||reading} onClick={()=>void chooseRecording()}>选择已保存录音</Button><a href="/rec" target="_blank" rel="noopener noreferrer" className="text-13 underline">开始录音</a>{recordingName&&<span className="text-13">已选：{recordingName}</span>}</div>
    {recordings&&<section aria-label="已保存录音" className="flex flex-wrap gap-2">{recordings.length?recordings.map(item=><Button key={item.sessionId} variant="outline" disabled={busy} onClick={()=>{setTranscriptionId(item.sessionId);setRecordingName(item.name);setFile(null);fileRevision.current++;setRecordings(null);}}>{item.name}</Button>):<p className="text-13 text-muted-foreground">暂无已停止并保存的录音，请先录音后重新选择。</p>}</section>}
    <p className="text-12 text-muted-foreground">仅使用自己的已停止录音逐字稿；录音在现有录音页面完成，返回后选择。</p>
    {error&&<p role="alert" className="text-13 text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">{busy?<Button variant="outline" onClick={cancel}>取消生成</Button>:null}<Button disabled={busy||reading||(!text.trim()&&!transcriptionId&&!file)} onClick={()=>void generate()}>{busy?'正在生成…':'生成问卷'}</Button></div>
    <Dialog open={!!proposal} onOpenChange={open=>{if(!open)setProposal(null);}}><DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
      <DialogTitle>Markdown 预览与校对</DialogTitle><DialogDescription>AI 提案尚未应用。检查内容并修改，确认后应用到问卷。</DialogDescription>
      <p className="text-12 text-muted-foreground">{proposal?.execution.provider} / {proposal?.execution.modelId} · 来源：{proposal?.source.kind}</p>
      <div className="grid gap-4 md:grid-cols-2"><textarea aria-label="AI 提案 Markdown" value={markdown} onChange={event=>setMarkdown(event.target.value)} className="min-h-80 rounded-md border border-border bg-background p-3 font-mono text-13"/>
        <section aria-label="AI 题目预览">{parsed.ok?<><h2 className="text-18 font-semibold">{parsed.draft.title}</h2>{parsed.draft.questions.map((question,index)=><article key={question.id} className="space-y-2 border-b border-border py-3"><h3>{index+1}. {question.title}</h3>{question.options?.map(option=><p key={option} className="text-13 text-muted-foreground">○ {option}</p>)}</article>)}</>:<p role="alert">请修正 Markdown：{parsed.diagnostics.map(d=>d.message).join('；')}</p>}</section></div>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={applying} onClick={()=>setProposal(null)}>返回输入</Button><Button disabled={!parsed.ok||applying} onClick={()=>{setApplying(true);setError('');void Promise.resolve(onApply(markdown)).then(()=>setProposal(null)).catch(cause=>setError(cause instanceof Error?cause.message:'应用失败，请重试。')).finally(()=>setApplying(false));}}>{applying?'正在应用…':'应用到问卷'}</Button></div>
      {error&&<p role="alert" className="text-destructive">{error}</p>}
    </DialogContent></Dialog>
  </section>;
}
