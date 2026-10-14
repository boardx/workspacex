'use client';
import * as React from 'react';
import { Paperclip, FileText, X } from 'lucide-react';
import { InterviewVoiceInput } from '@/components/itv/interview-voice-input';
import { getStoredSessionToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { SURVEY_PROPOSAL_FILE_MAX_BYTES,SURVEY_PROPOSAL_TEXT_MAX_CHARS,SurveyMarkdownProposalSchema,type SurveyMarkdownProposal } from '@repo/contracts/survey-markdown-proposal';
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
  const fileInput=React.useRef<HTMLInputElement>(null);
  const [sessionToken,setSessionToken]=React.useState('');
  const [voicePreview,setVoicePreview]=React.useState('');
  const [voiceBusy,setVoiceBusy]=React.useState(false);
  React.useEffect(()=>{setSessionToken(getStoredSessionToken()??'');},[]);
  const appendVoice=React.useCallback((confirmed:string)=>{
    setVoicePreview('');
    setText(current=>[current,confirmed].filter(Boolean).join('\n\n'));
  },[]);
  const displayedText=[text,voicePreview].filter(Boolean).join('\n\n');
  const overLimit=text.trim().length>SURVEY_PROPOSAL_TEXT_MAX_CHARS;
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
    if(voiceBusy||reading||busy||overLimit)return;
    const id=++revision.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError('');
    try{const result=await surveyRequest('/surveys/markdown-proposals',{method:'POST',body:{text,...(transcriptionId?{transcriptionId}: {}),...(file?{file}: {})},signal:controller.signal},SurveyMarkdownProposalSchema);
      if(id!==revision.current||controller.signal.aborted)return;setProposal(result);setMarkdown(result.markdown);
    }catch{if(id===revision.current&&!controller.signal.aborted)setError('生成失败，请检查输入或模型配置后重试。原问卷未改变。');}
    finally{if(id===revision.current)setBusy(false);}
  }
  const parsed=parseSurveyDesignMarkdown(markdown);
  if(locked)return null;
  return <section aria-label="AI 问卷生成" className="space-y-6">
    <div className="rounded-lg border border-border bg-card p-5 sm:p-8">
      <h2 className="mb-5 text-20 font-semibold">告诉我们，你想了解什么？</h2>
      <div role="group" aria-label="问卷输入" data-testid="survey-intake-composer" className="rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
        <textarea aria-label="问卷需求" maxLength={SURVEY_PROPOSAL_TEXT_MAX_CHARS} disabled={busy||voiceBusy} value={displayedText} onChange={event=>setText(event.target.value)} className="min-h-64 w-full resize-y rounded-t-lg border-0 bg-transparent p-4 text-14 leading-relaxed outline-none sm:min-h-72" placeholder="调研目标、受众与关注内容…"/>
        <div className="flex flex-wrap items-start gap-2 px-3 pb-3">
          <input ref={fileInput} aria-label="上传问卷文件" type="file" accept=".md,.markdown,.txt,.pdf,.docx" disabled={busy||voiceBusy} onChange={event=>upload(event.target.files?.[0])} className="sr-only" tabIndex={-1}/>
          <Button variant="outline" disabled={busy||reading||voiceBusy} title={`支持 Markdown、TXT、PDF 和 DOCX，最多 ${SURVEY_PROPOSAL_FILE_MAX_BYTES/1024} KB`} onClick={()=>fileInput.current?.click()}><Paperclip className="mr-2 size-4" aria-hidden/>添加文件</Button>
          <InterviewVoiceInput compact sessionToken={sessionToken} disabled={busy||reading||applying} onPreview={setVoicePreview} onAppend={appendVoice} onBusyChange={setVoiceBusy}/>
          <Button variant="outline" disabled={busy||reading||voiceBusy} onClick={()=>void chooseRecording()}>选择已保存录音</Button>
          {reading&&<span role="status" className="self-center text-12 text-muted-foreground">读取文件…</span>}
          {file&&<span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md bg-muted px-3 py-2 text-13"><FileText className="size-4 shrink-0" aria-hidden/><span className="truncate">{file.name}</span><button type="button" aria-label={`移除文件 ${file.name}`} disabled={busy||reading||voiceBusy} onClick={()=>{fileRevision.current++;setFile(null);if(fileInput.current)fileInput.current.value='';}} className="rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden/></button></span>}
          {recordingName&&<span className="rounded-md bg-muted px-3 py-2 text-13">{recordingName}</span>}
          <span className="ml-auto self-center whitespace-nowrap px-1 text-12 text-muted-foreground" aria-label="需求字数">{displayedText.trim().length.toLocaleString()} / {SURVEY_PROPOSAL_TEXT_MAX_CHARS.toLocaleString()}</span>
        </div>
        {recordings&&<section aria-label="已保存录音" className="flex flex-wrap gap-2 border-t border-border p-3">{recordings.length?recordings.map(item=><Button key={item.sessionId} variant="outline" disabled={busy||voiceBusy||reading} onClick={()=>{setTranscriptionId(item.sessionId);setRecordingName(item.name);setFile(null);fileRevision.current++;setRecordings(null);}}>{item.name}</Button>):<p className="text-13 text-muted-foreground">暂无已保存录音</p>}</section>}
      </div>
      {overLimit&&<p role="alert" className="mt-3 text-13 text-destructive">需求内容超过 {SURVEY_PROPOSAL_TEXT_MAX_CHARS} 字符（当前 {text.trim().length}）。转写已完整保留，请缩短需求后再生成。</p>}
      {error&&<p role="alert" className="mt-3 text-13 text-destructive">{error}</p>}
    </div>
    <div className="flex justify-end gap-2">{busy?<Button variant="outline" onClick={cancel}>取消生成</Button>:null}<Button disabled={busy||reading||voiceBusy||overLimit||(!text.trim()&&!transcriptionId&&!file)} onClick={()=>void generate()}>{busy?'正在生成…':'生成问卷'}</Button></div>
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
