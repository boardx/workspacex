"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { previewAidtPdf } from "../lib/aidt-print-preview";

function guideLabels(observation:boolean) {
  return observation ? { title:"观察计划 · 学生采纳稿", note:"用于准备实地观察，不代表观察已开展或证据已核实。" }
    : { title:"访谈问题清单 · 学生采纳稿", note:"用于准备访谈，不代表采访已开展或证据已核实。" };
}
function guideDocument(adoptedGuide:string,labels:ReturnType<typeof guideLabels>) {
  const article=document.createElement("article"),title=document.createElement("h2"),text=document.createElement("pre"),note=document.createElement("p");
  title.textContent=labels.title; text.textContent=adoptedGuide;
  text.style.whiteSpace="pre-wrap";text.style.overflowWrap="anywhere";text.style.fontFamily="inherit";
  note.textContent=labels.note;article.append(title,text,note);return article;
}
type Props={scopeKey:string;guide:string;adoptedGuide:string;kind?:"interview"|"observation"};
/** Read-only export of the student's adopted field; never replaces or saves their original guide. */
export function AidtInterviewGuideExport(props:Props) {
  return <GuideExport key={props.scopeKey} {...props}/>;
}
function GuideExport({guide,adoptedGuide,kind="interview"}:Props) {
  const observation=kind==="observation",labels=guideLabels(observation);
  const [preview,setPreview]=React.useState(false),[printing,setPrinting]=React.useState(false);
  const [status,setStatus]=React.useState<{key:string;text:string}|null>(null);
  const key=JSON.stringify([guide,adoptedGuide,kind]);
  const life=React.useRef({key,generation:0,active:true});
  if(life.current.key!==key){life.current.key=key;life.current.generation++;}
  React.useEffect(()=>{const owner=life.current;owner.active=true;return()=>{owner.active=false;};},[]);
  const busy=React.useRef(false),ready=Boolean(adoptedGuide.trim());
  async function print() {
    if(!ready || busy.current)return;
    busy.current=true;setPrinting(true);setPreview(true);setStatus(null);
    const generation=life.current.generation,isCurrent=()=>life.current.active && life.current.generation===generation;
    try {
      const result=await previewAidtPdf(guideDocument(adoptedGuide,labels),labels.title,{isCurrent});
      if(isCurrent())setStatus({key,text:result==="cancelled"?"已关闭打印预览，清单未改变。":"已请求系统打印。是否另存成功请核对实际 PDF 文件。"});
    }catch{
      if(life.current.active)setStatus({key:life.current.key,text:isCurrent()?"打印预览未能打开，采纳稿和原稿仍保留。可重试。":"内容已变化，未打印旧稿。请重新预览后重试。"});
    }finally{busy.current=false;if(life.current.active)setPrinting(false);}
  }
  return <section className="space-y-3 border-t border-border pt-4 text-12" data-testid="aidt-interview-guide-export">
    <h4 className="text-14 font-semibold">{observation?"观察计划预览与导出":"访谈清单预览与导出"}</h4>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!ready || printing} data-testid="aidt-interview-guide-preview-toggle" onClick={()=>setPreview(value=>!value)}>{preview?"收起采纳清单":"预览采纳清单"}</Button><Button type="button" size="sm" variant="outline" disabled={!ready || printing} data-testid="aidt-interview-guide-print" onClick={()=>void print()}>{printing?"正在准备打印…":"PDF 打印预览"}</Button></div>
    <p className="text-muted-foreground">{ready?"只导出本页采纳稿；是否已保存到小组，以上方回执为准。":observation?"先确认小组采纳的观察计划，原稿不会自动代替。":"先填写‘采纳建议后的问题清单’，原稿不会自动代替。"}</p>
    {preview && ready && <article className="rounded-lg border border-border bg-card p-4" aria-label={observation?"已采纳观察计划预览":"已采纳访谈问题清单预览"} data-testid="aidt-interview-guide-preview"><h5 className="text-14 font-semibold">{labels.title}</h5><pre className="mt-3 whitespace-pre-wrap break-words font-sans leading-relaxed">{adoptedGuide}</pre><p className="mt-3 text-11 text-muted-foreground">{labels.note}</p></article>}
    <details className="text-muted-foreground" data-testid="aidt-interview-guide-original"><summary className="cursor-pointer">{observation?"对照观察计划原稿（不打印）":"对照提纲原稿（不打印）"}</summary><p className="mt-2 whitespace-pre-wrap break-words">{guide.trim()?guide:"尚未填写原稿，未自动补写。"}</p></details>
    {status?.key===key && <p role="status" aria-live="polite" data-testid="aidt-interview-guide-status">{status.text}</p>}
  </section>;
}
