"use client";
import { WorkflowActionBar, WorkflowActionButton } from "@/components/research-studio/research-workflow-actions";

import * as React from "react";
import { SurveyDraftInputSchema, SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { SurveyLibraryTemplateSchema, type SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
import { Input } from "@/components/ui/input";
import { TagField, commitDraft } from "@/components/ui/tag-input";
import { tagInputLimits, surveySource } from "@repo/contracts";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { getBuiltinSurveyTemplates } from "@/lib/survey/builtin-templates";
import type { SurveyCreationDraft } from "@/lib/survey/creation-draft";
import { useI18n } from "@/lib/i18n/provider";
import { displaySurveyMessage, surveyErrorMessage, type SurveyDisplayMessage } from "@/lib/survey/display-message";
const TAG_LIMITS = tagInputLimits(surveySource.SurveyTagsSchema);

export function CreateSurveyDialog({open,onOpenChange,onCreated,knownTags,onReturnFocus}: {
  /** 已有标签词表，给输入框做建议。 */
  knownTags?:ReadonlyMap<string,number>;
  onReturnFocus?:()=>void;
  open:boolean;onOpenChange:(open:boolean)=>void;onCreated:(id:string|null,mode:"blank"|"ai"|"template",draft?:SurveyCreationDraft)=>void;
}) {
  const { t, locale } = useI18n();
  const [name,setName]=React.useState("");
  const [tags,setTags]=React.useState<readonly string[]>([]);
  const [pendingTag,setPendingTag]=React.useState("");
  const [mode,setMode]=React.useState<"blank"|"ai"|"template">("blank");
  const [selected,setSelected]=React.useState("");
  const [templates,setTemplates]=React.useState<SurveyLibraryTemplate[]>([]);
  const [error,setError]=React.useState<SurveyDisplayMessage | null>(null);
  const [loading,setLoading]=React.useState(false);
  const [busy,setBusy]=React.useState(false);
  const lock=React.useRef(false);
  const navigated=React.useRef(false);
  const builtins=React.useMemo(()=>getBuiltinSurveyTemplates("question"),[]);
  React.useEffect(()=>{if(open){navigated.current=false;setName("");setTags([]);setPendingTag("");setMode("blank");setSelected("");setError(null);}},[open]);
  React.useEffect(()=>{
    if(!open || mode!=="template"){setLoading(false);return;}
    let active=true;setLoading(true);setError(null);
    void surveyRequest("/surveys/templates?kind=question").then(value=>{
      const rows=SurveyLibraryTemplateSchema.array().parse(value);
      if(rows.some(row=>row.kind!=="question")){if(active)setError({key:"survey.create.invalidTemplateData"});return;}
      if(active)setTemplates(rows);
    }).catch(e=>{if(active)setError(surveyErrorMessage(e,"survey.create.loadTemplatesFailed"));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[open,mode]);
  function allTags(){return [...commitDraft(tags,pendingTag,TAG_LIMITS)];}
  async function create(event:React.FormEvent){
    event.preventDefault();if(lock.current)return;setError(null);
    const source=[...builtins,...templates].find(row=>row.id===selected);
    if(mode==="template" && (!source || !source.questions.length)){setError({key:"survey.create.templateRequired"});return;}
    const parsed=SurveyDraftInputSchema.safeParse({title:name,tags:allTags(),
      questions:mode==="template" && source ? structuredClone(source.questions).map(question=>({...question,provenance:{source:"template",sourceId:source.id}})) : [],
      template:mode==="template" && source ? structuredClone(source.template) : {id:crypto.randomUUID(),title:t("survey.create.reportTitle",{name:name.trim()}),sections:[]},
    });
    if(!parsed.success){setError({key:"survey.create.invalidFields"});return;}
    if(mode==="ai"){
      navigated.current=true;
      onOpenChange(false);
      onCreated(null,"ai",{name:parsed.data.title,tags:parsed.data.tags??[]});
      return;
    }
    lock.current=true;setBusy(true);
    try{const created=await surveyRequest("/surveys",{method:"POST",body:parsed.data},SurveyRuntimeSchema);navigated.current=true;onOpenChange(false);onCreated(created.id,mode);}
    catch(e){setError(surveyErrorMessage(e,"survey.create.failed"));}
    finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!lock.current)onOpenChange(value);}}><DialogContent className="max-w-2xl" onCloseAutoFocus={event=>{if(onReturnFocus&&!navigated.current){event.preventDefault();onReturnFocus();}}}>
    <DialogTitle>{t("survey.create.title")}</DialogTitle><DialogDescription className="sr-only">{t("survey.create.description")}</DialogDescription>
    <form className="space-y-5" onSubmit={event=>void create(event)}>
      <label className="block space-y-2 text-13">{t("survey.create.name")}<Input aria-label={t("survey.create.name")} disabled={busy} value={name} onChange={event=>setName(event.target.value)} autoFocus /></label>
      <TagField value={tags} onChange={setTags} draft={pendingTag} onDraftChange={setPendingTag} knownTags={knownTags} disabled={busy} {...TAG_LIMITS} testIdPrefix="survey-create-tag" label={t("survey.create.tags")} />
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-13 font-medium">{t("survey.create.chooseMode")}</legend><div className="grid gap-3 sm:grid-cols-3">
        {([ ["blank","survey.create.blank","survey.create.blankHint"],["ai","survey.create.ai","survey.create.aiHint"],["template","survey.create.template","survey.create.templateHint"] ] as const).map(([value,title,description])=><label key={value} className={`rounded-lg border p-4 ${mode===value?"border-primary bg-accent":"border-border"}`}><input type="radio" name="survey-create-mode" value={value} checked={mode===value} onChange={()=>{setMode(value);setError(null);}} /><span className="ml-2 font-medium">{t(title)}</span><p className="mt-2 text-12 text-muted-foreground">{t(description)}</p></label>)}
      </div></fieldset>
      {mode==="template"&&<label className="block text-13">{t("survey.create.templateLabel")}<select aria-label={t("survey.create.selectTemplate")} disabled={busy||loading} value={selected} onChange={event=>setSelected(event.target.value)} className="mt-2 w-full rounded-md border border-border bg-card p-2"><option value="">{t(loading?"survey.create.loadingTemplates":"survey.create.templatePlaceholder")}</option>{[...builtins,...templates].map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
      {error&&<p role="alert" className="text-13 text-destructive">{displaySurveyMessage(error,t,locale)}</p>}
      <WorkflowActionBar><WorkflowActionButton type="button" variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>{t("common.cancel")}</WorkflowActionButton><WorkflowActionButton type="submit" variant="primary" disabled={busy||!name.trim()||loading}>{t(busy?"survey.create.creating":"survey.create.next")}</WorkflowActionButton></WorkflowActionBar>
    </form>
  </DialogContent></Dialog>;
}
