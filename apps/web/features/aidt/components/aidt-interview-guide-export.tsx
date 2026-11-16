"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { printResearchPdf } from "@/lib/research-report-export";

const TITLE = "访谈问题清单 · 学生采纳稿";
const NOTE = "用于准备访谈，不代表采访已开展或证据已核实。";
function guideDocument(adoptedGuide:string) {
  const article=document.createElement("article"),title=document.createElement("h2"),text=document.createElement("pre"),note=document.createElement("p");
  title.textContent=TITLE; text.textContent=adoptedGuide;
  text.style.whiteSpace="pre-wrap";text.style.overflowWrap="anywhere";text.style.fontFamily="inherit";
  note.textContent=NOTE;article.append(title,text,note);return article;
}
type Props={scopeKey:string;guide:string;adoptedGuide:string};
/** Read-only export of the student's adopted field; never replaces or saves their original guide. */
export function AidtInterviewGuideExport(props:Props) {
  return <GuideExport key={props.scopeKey} {...props}/>;
}
function GuideExport({guide,adoptedGuide}:Props) {
  const [preview,setPreview]=React.useState(false),[printing,setPrinting]=React.useState(false);
  const [status,setStatus]=React.useState<{key:string;text:string}|null>(null);
  const key=JSON.stringify([guide,adoptedGuide]);
  const life=React.useRef({key,generation:0,active:true});
  if(life.current.key!==key){life.current.key=key;life.current.generation++;}
  React.useEffect(()=>{const owner=life.current;owner.active=true;return()=>{owner.active=false;};},[]);
  const busy=React.useRef(false),ready=Boolean(adoptedGuide.trim());
  async function print() {
    if(!ready || busy.current)return;
    busy.current=true;setPrinting(true);setPreview(true);setStatus(null);
    const generation=life.current.generation,isCurrent=()=>life.current.active && life.current.generation===generation;
    try {
      await printResearchPdf(guideDocument(adoptedGuide),TITLE,{isCurrent});
      if(isCurrent())setStatus({key,text:"已请求打开打印预览。请在浏览器选择另存为PDF，并核对实际文件。"});
    }catch{
      if(life.current.active)setStatus({key:life.current.key,text:isCurrent()?"打印预览未能打开，采纳稿和原稿仍保留。可重试。":"内容已变化，未打印旧稿。请重新预览后重试。"});
    }finally{busy.current=false;if(life.current.active)setPrinting(false);}
  }
  return <section className="space-y-3 border-t border-border pt-4 text-12" data-testid="aidt-interview-guide-export">
    <h4 className="text-14 font-semibold">访谈清单预览与导出</h4>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!ready || printing} data-testid="aidt-interview-guide-preview-toggle" onClick={()=>setPreview(value=>!value)}>{preview?"收起采纳清单":"预览采纳清单"}</Button><Button type="button" size="sm" variant="outline" disabled={!ready || printing} data-testid="aidt-interview-guide-print" onClick={()=>void print()}>{printing?"正在准备打印…":"PDF 打印预览"}</Button></div>
    <p className="text-muted-foreground">{ready?"只导出本页采纳稿；是否已保存到小组，以上方回执为准。":"先填写‘采纳建议后的问题清单’，原稿不会自动代替。"}</p>
    {preview && ready && <article className="rounded-lg border border-border bg-card p-4" aria-label="已采纳访谈问题清单预览" data-testid="aidt-interview-guide-preview"><h5 className="text-14 font-semibold">{TITLE}</h5><pre className="mt-3 whitespace-pre-wrap break-words font-sans leading-relaxed">{adoptedGuide}</pre><p className="mt-3 text-11 text-muted-foreground">{NOTE}</p></article>}
    <details className="text-muted-foreground" data-testid="aidt-interview-guide-original"><summary className="cursor-pointer">对照提纲原稿（不打印）</summary><p className="mt-2 whitespace-pre-wrap break-words">{guide.trim()?guide:"尚未填写原稿，未自动补写。"}</p></details>
    {status?.key===key && <p role="status" aria-live="polite" data-testid="aidt-interview-guide-status">{status.text}</p>}
  </section>;
}
