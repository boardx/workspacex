"use client";
import * as React from "react";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { SurveyTagsSchema } from "@repo/contracts/survey-source";
import { SurveyLibraryTemplateSchema, type SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { getBuiltinSurveyTemplates } from "@/lib/survey/builtin-templates";

export function CreateSurveyDialog({open,onOpenChange,onCreated}: {
  open:boolean;onOpenChange:(open:boolean)=>void;onCreated:(id:string)=>void;
}) {
  const [name,setName]=React.useState("");
  const [tags,setTags]=React.useState<string[]>([]);
  const [pendingTag,setPendingTag]=React.useState("");
  const [mode,setMode]=React.useState("blank");
  const [selected,setSelected]=React.useState("");
  const [templates,setTemplates]=React.useState<SurveyLibraryTemplate[]>([]);
  const [error,setError]=React.useState("");
  const [loading,setLoading]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const lock=React.useRef(false);
  const builtins=React.useMemo(()=>getBuiltinSurveyTemplates("question"),[]);
  React.useEffect(()=>{if(open){setName("");setTags([]);setPendingTag("");setMode("blank");setSelected("");setError("");}},[open]);
  React.useEffect(()=>{
    if(!open || mode!=="template")return;
    let active=true;setLoading(true);setError("");
    void surveyRequest("/surveys/templates?kind=question").then(value=>{
      const rows=SurveyLibraryTemplateSchema.array().parse(value);
      if(rows.some(row=>row.kind!=="question"))throw new Error("模板数据格式不正确");
      if(active)setTemplates(rows);
    }).catch(e=>{if(active)setError(e instanceof Error ? e.message : "模板加载失败");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,mode]);
  function allTags(){const tag=pendingTag.trim();return tag&&!tags.includes(tag)?[...tags,tag]:tags;}
  function addTag(){const parsed=SurveyTagsSchema.safeParse(allTags());if(!parsed.success){setError("标签最多五个，每个不超过二十字。");return;}setTags(parsed.data);setPendingTag("");setError("");}
  async function create(event:React.FormEvent){
    event.preventDefault();if(lock.current)return;setError("");
    const source=[...builtins,...templates].find(row=>row.id===selected);
    if(mode==="template" && (!source || !source.questions.length)){setError("请选择包含题目的问卷模板。");return;}
    const parsed=SurveyDraftInputSchema.safeParse({title:name,tags:allTags(),
      questions:mode==="template" && source ? structuredClone(source.questions).map(question=>({...question,provenance:{source:"template",sourceId:source.id}})) : [],
      template:mode==="template" && source ? structuredClone(source.template) : {id:crypto.randomUUID(),title:`${name.trim()}分析报告`,sections:[]},
    });
    if(!parsed.success){setError("请填写有效的问卷名称和标签。");return;}
    lock.current=true;setBusy(true);
    try{const created=await surveyRequest("/surveys",{method:"POST",body:parsed.data},SurveyRuntimeSchema);onOpenChange(false);onCreated(created.id);}
    catch(e){setError(e instanceof Error?e.message:"创建失败，请重试");}
    finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!lock.current)onOpenChange(value);}}><DialogContent className="max-w-2xl">
    <DialogTitle>新建问卷</DialogTitle><DialogDescription>先填写名称与标签，再选择创建方式。报告模板为可选项。</DialogDescription>
    <form className="space-y-5" onSubmit={event=>void create(event)}>
      <label className="block space-y-2 text-13">问卷名称<Input aria-label="问卷名称" disabled={busy} value={name} onChange={event=>setName(event.target.value)} autoFocus /></label>
      <div className="space-y-2"><label htmlFor="survey-new-tags" className="text-13">标签</label><div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
        {tags.map(tag=><Button type="button" key={tag} size="sm" variant="outline" disabled={busy} aria-label={`移除标签 ${tag}`} onClick={()=>setTags(tags.filter(item=>item!==tag))}>{tag} ×</Button>)}
        <Input id="survey-new-tags" value={pendingTag} disabled={busy} placeholder="输入标签后回车" onChange={event=>setPendingTag(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();addTag();}}} className="min-w-32 flex-1 border-0" />
      </div></div>
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-13 font-medium">选择创建方式</legend><div className="grid gap-3 sm:grid-cols-3">
        {[["blank","空白创建","直接进入手工设计问卷"],["markdown","Markdown 导入创建","进入设计区粘贴或上传 Markdown，校对后应用"],["template","从模板创建","使用现有问卷模板快速开始"]].map(([value,title,description])=><label key={value} className={`rounded-lg border p-4 ${mode===value?"border-primary bg-accent":"border-border"}`}><input type="radio" name="survey-create-mode" value={value} checked={mode===value} onChange={()=>{setMode(value!);setError("");}} /><span className="ml-2 font-medium">{title}</span><p className="mt-2 text-12 text-muted-foreground">{description}</p></label>)}
      </div></fieldset>
      {mode==="template"&&<label className="block text-13">问卷模板<select aria-label="选择问卷模板" disabled={busy||loading} value={selected} onChange={event=>setSelected(event.target.value)} className="mt-2 w-full rounded-md border border-border bg-card p-2"><option value="">{loading?"正在加载模板…":"请选择问卷模板"}</option>{[...builtins,...templates].map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
      {error&&<p role="alert" className="text-13 text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy||!name.trim()||loading}>{busy?"正在创建…":"下一步"}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
