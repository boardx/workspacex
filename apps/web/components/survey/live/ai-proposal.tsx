'use client';
import { WorkflowActionBar, WorkflowActionButton } from '@/components/research-studio/research-workflow-actions';
import * as React from 'react';
import { displaySurveyDiagnostic } from '@/lib/survey/display-diagnostic';
import { Paperclip, FileText, X } from 'lucide-react';
import { InterviewVoiceInput } from '@/components/itv/interview-voice-input';
import { getStoredSessionToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { SURVEY_PROPOSAL_FILE_MAX_BYTES,SURVEY_PROPOSAL_TEXT_MAX_CHARS,SurveyMarkdownProposalSchema,type SurveyMarkdownProposal } from '@repo/contracts/survey-markdown-proposal';
import { parseSurveyDesignMarkdown } from '@repo/contracts/survey-source';
import { surveyRequest } from '@/lib/survey/runtime-client';
import { listPersonalTranscriptions,type PersonalTranscriptionSummary } from '@/lib/live-personal-transcriptions';
import { useI18n } from '@/lib/i18n/provider';
import { displaySurveyMessage, surveyErrorMessage, type SurveyDisplayMessage } from '@/lib/survey/display-message';
export function SurveyAiProposal({locked,onApply,storageKey}:{locked:boolean;onApply:(markdown:string)=>void|Promise<void>;storageKey?:string}) {
  const { t, locale } = useI18n();
  const [text,setText]=React.useState('');const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState<SurveyDisplayMessage|null>(null);
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
    const id=revision.current;setError(null);
    try{const page=await listPersonalTranscriptions();if(id===revision.current)setRecordings(page.items.filter(item=>item.status==='idle'));}
    catch{if(id===revision.current)setError({key:'survey.import.loadRecordingsFailed'});}
  }
  const fileRevision=React.useRef(0);
  function upload(selected:File|undefined){
    const version=++fileRevision.current;setFile(null);setError(null);setReading(false);setTranscriptionId('');setRecordingName('');
    if(!selected)return;
    if(selected.size>SURVEY_PROPOSAL_FILE_MAX_BYTES){setError({key:'survey.import.fileTooLarge',params:{max:SURVEY_PROPOSAL_FILE_MAX_BYTES/1024}});return;}
    setReading(true);const reader=new FileReader();reader.onload=()=>{if(version!==fileRevision.current)return;setReading(false);
      const result=String(reader.result);setFile({name:selected.name,base64:result.slice(result.indexOf(',')+1)});setTranscriptionId('');};
    reader.onerror=()=>{if(version===fileRevision.current){setReading(false);setError({key:'survey.import.readFailed'});}};reader.readAsDataURL(selected);
  }
  const revision=React.useRef(0);const abort=React.useRef<AbortController|null>(null);
  function cancel(){revision.current++;abort.current?.abort();setBusy(false);}
  React.useEffect(()=>()=>{revision.current++;fileRevision.current++;abort.current?.abort();},[]);
  async function generate(){
    if(voiceBusy||reading||busy||overLimit)return;
    const id=++revision.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setError(null);
    try{const result=await surveyRequest('/surveys/markdown-proposals',{method:'POST',body:{text,...(transcriptionId?{transcriptionId}: {}),...(file?{file}: {})},signal:controller.signal},SurveyMarkdownProposalSchema);
      if(id!==revision.current||controller.signal.aborted)return;setProposal(result);setMarkdown(result.markdown);
    }catch{if(id===revision.current&&!controller.signal.aborted)setError({key:'survey.import.generateFailed'});}
    finally{if(id===revision.current)setBusy(false);}
  }
  const parsed=parseSurveyDesignMarkdown(markdown);
  if(locked)return null;
  return <section aria-label={t("survey.import.section")} className="space-y-4">
    <div className="space-y-3">
      <h2 className="text-20 font-semibold">{t("survey.import.prompt")}</h2>
      <div role="group" aria-label={t("survey.import.inputGroup")} data-testid="survey-intake-composer" className="rounded-lg border border-border bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring">
        <textarea aria-label={t("survey.import.requirements")} maxLength={SURVEY_PROPOSAL_TEXT_MAX_CHARS} disabled={busy||voiceBusy} value={displayedText} onChange={event=>setText(event.target.value)} className="min-h-56 w-full resize-y rounded-t-lg border-0 bg-transparent p-4 text-14 leading-relaxed outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-60" placeholder={t("survey.import.placeholder")}/>
        <div className="flex flex-wrap items-start gap-2 px-3 pb-3">
          <input ref={fileInput} aria-label={t("survey.import.upload")} type="file" accept=".md,.markdown,.txt,.pdf,.docx" disabled={busy||voiceBusy} onChange={event=>{const selected=event.currentTarget.files?.[0];event.currentTarget.value='';upload(selected);}} className="sr-only" tabIndex={-1}/>
          <Button variant="outline" disabled={busy||reading||voiceBusy} title={t("survey.import.fileTypes",{max:SURVEY_PROPOSAL_FILE_MAX_BYTES/1024})} onClick={()=>fileInput.current?.click()}><Paperclip className="mr-2 size-4" aria-hidden/>{t("survey.import.addFile")}</Button>
          <InterviewVoiceInput compact sessionToken={sessionToken} disabled={busy||reading||applying} onPreview={setVoicePreview} onAppend={appendVoice} onBusyChange={setVoiceBusy}/>
          <Button variant="outline" disabled={busy||reading||voiceBusy} onClick={()=>void chooseRecording()}>{t("survey.import.chooseRecording")}</Button>
          {reading&&<span role="status" className="self-center text-12 text-muted-foreground">{t("survey.import.reading")}</span>}
          {file&&<span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md bg-muted px-3 py-2 text-13"><FileText className="size-4 shrink-0" aria-hidden/><span className="truncate">{file.name}</span><button type="button" aria-label={t("survey.import.removeFile",{name:file.name})} disabled={busy||reading||voiceBusy} onClick={()=>{fileRevision.current++;setFile(null);if(fileInput.current)fileInput.current.value='';}} className="rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden/></button></span>}
          {recordingName&&<span className="rounded-md bg-muted px-3 py-2 text-13">{recordingName}</span>}
          <span className="ml-auto self-center whitespace-nowrap px-1 text-12 text-muted-foreground" aria-label={t("survey.import.characterCount")}>{displayedText.trim().length.toLocaleString(locale)} / {SURVEY_PROPOSAL_TEXT_MAX_CHARS.toLocaleString(locale)}</span>
        </div>
        {recordings&&<section aria-label={t("survey.import.recordings")} className="flex flex-wrap gap-2 border-t border-border p-3">{recordings.length?recordings.map(item=><Button key={item.sessionId} variant="outline" disabled={busy||voiceBusy||reading} onClick={()=>{setTranscriptionId(item.sessionId);setRecordingName(item.name);setFile(null);fileRevision.current++;setRecordings(null);}}>{item.name}</Button>):<p className="text-13 text-muted-foreground">{t("survey.import.noRecordings")}</p>}</section>}
      </div>
      {overLimit&&<p role="alert" className="mt-3 text-13 text-destructive">{t("survey.import.tooLong",{max:SURVEY_PROPOSAL_TEXT_MAX_CHARS,count:text.trim().length})}</p>}
      {error&&<p role="alert" className="mt-3 text-13 text-destructive">{displaySurveyMessage(error,t,locale)}</p>}
    </div>
    <WorkflowActionBar placement="footer">{busy?<WorkflowActionButton variant="outline" onClick={cancel}>{t("survey.import.cancel")}</WorkflowActionButton>:null}<WorkflowActionButton variant="primary" disabled={busy||reading||voiceBusy||overLimit||(!text.trim()&&!transcriptionId&&!file)} onClick={()=>void generate()}>{t(busy?'survey.import.generating':'survey.import.generate')}</WorkflowActionButton></WorkflowActionBar>
    <Dialog open={!!proposal} onOpenChange={open=>{if(!open)setProposal(null);}}><DialogContent className="max-h-[85vh] max-w-5xl overflow-auto">
      <DialogTitle>{t("survey.import.previewTitle")}</DialogTitle><DialogDescription>{t("survey.import.previewDescription")}</DialogDescription>
      <p className="text-12 text-muted-foreground">{proposal?.execution.provider} / {proposal?.execution.modelId} · {t("survey.import.source",{kind:proposal?.source.kind??""})}</p>
      <div className="grid gap-4 md:grid-cols-2"><textarea aria-label={t("survey.import.markdown")} value={markdown} onChange={event=>setMarkdown(event.target.value)} className="min-h-80 rounded-md border border-border bg-background p-3 font-mono text-13"/>
        <section aria-label={t("survey.import.questionPreview")}>{parsed.ok?<><h2 className="text-18 font-semibold">{parsed.draft.title}</h2>{parsed.draft.questions.map((question,index)=><article key={question.id} className="space-y-2 border-b border-border py-3"><h3>{index+1}. {question.title}</h3>{question.options?.map(option=><p key={option} className="text-13 text-muted-foreground">○ {option}</p>)}</article>)}</>:<p role="alert"> {t("survey.import.fixMarkdown",{details:parsed.diagnostics.map(d=>displaySurveyDiagnostic(d.message,t)).join(locale==='zh-CN'?'；':'; ' )})}</p>}</section></div>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={applying} onClick={()=>setProposal(null)}>{t("survey.import.backInput")}</Button><Button disabled={!parsed.ok||applying} onClick={()=>{setApplying(true);setError(null);void Promise.resolve(onApply(markdown)).then(()=>setProposal(null)).catch(cause=>setError(surveyErrorMessage(cause,'survey.import.applyFailed'))).finally(()=>setApplying(false));}}>{t(applying?'survey.import.applying':'survey.import.apply')}</Button></div>
      {error&&<p role="alert" className="text-destructive">{displaySurveyMessage(error,t,locale)}</p>}
    </DialogContent></Dialog>
  </section>;
}
