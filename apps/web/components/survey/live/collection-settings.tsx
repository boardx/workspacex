'use client';
import { useI18n } from "@/lib/i18n/provider";
import * as React from 'react';
import { parseSurveyPublicationMarkdown, serializeSurveyPublicationMarkdown, SurveyCollectionSettingsSchema, type SurveyCollectionSettings } from '@repo/contracts/survey-source';
import { SurveySuccessMarkdown } from './success-markdown';
export function SurveyCollectionSettingsEditor({markdown,locked,onChange}:{markdown:string;locked:boolean;onChange:(value:string)=>void}) {
  const { t } = useI18n();
  const parsed=parseSurveyPublicationMarkdown(markdown);
  const [settings,setSettings]=React.useState<SurveyCollectionSettings>(()=>parsed.ok?parsed.settings:{responseLimitScope:'none',successMessageMarkdown:'提交成功，感谢您的参与。'});
  const emitted=React.useRef<string>();
  React.useEffect(()=>{if(markdown===emitted.current)return;const next=parseSurveyPublicationMarkdown(markdown);if(next.ok)setSettings(next.settings);},[markdown]);
  function update(next:SurveyCollectionSettings) {
    setSettings(next);
    // Keep raw typing locally; only valid settings acquire a canonical source.
    // An invalid edit must also invalidate the parent's publishable document.
    const validated=SurveyCollectionSettingsSchema.safeParse(next);
    emitted.current=validated.success?serializeSurveyPublicationMarkdown(validated.data):'';
    onChange(emitted.current);
  }
  return <section aria-label={t("survey.workspace.limitsRegion")} className="space-y-4 rounded-lg border border-border bg-card p-5">
    <h2 className="text-16 font-semibold">{t("survey.workspace.collectionSettings")}</h2>
    <fieldset disabled={locked} className="space-y-4">
      <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={settings.responseLimitScope==='browser'} onChange={event=>update({...settings,responseLimitScope:event.target.checked?'browser':'none'})}/>{t("survey.workspace.browserLimit")}</label>
      <p className="text-12 text-muted-foreground">{t("survey.workspace.browserLimitHelp")}</p>
      <label className="block space-y-2 text-13">{t("survey.workspace.successMarkdown")}<textarea aria-label={t("survey.workspace.successMarkdown")} maxLength={10000} value={settings.successMessageMarkdown} onChange={event=>update({...settings,successMessageMarkdown:event.target.value})} className="block min-h-28 w-full rounded-md border border-border bg-background p-3 font-mono"/></label>
    </fieldset>
    {(!parsed.ok || !SurveyCollectionSettingsSchema.safeParse(settings).success) && <p role="alert" className="text-12 text-destructive">{t("survey.workspace.invalidSuccess")}</p>}
    <details><summary className="cursor-pointer text-13">{t("survey.workspace.previewSuccess")}</summary><div className="mt-3 rounded-md border border-border p-4"><SurveySuccessMarkdown markdown={settings.successMessageMarkdown}/></div></details>
    {locked && <p className="text-12 text-muted-foreground">{t("survey.workspace.frozenLimit")}</p>}
  </section>;
}
