'use client';
import * as React from 'react';
import { parseSurveyPublicationMarkdown, serializeSurveyPublicationMarkdown, SurveyCollectionSettingsSchema, type SurveyCollectionSettings } from '@repo/contracts/survey-source';
import { SurveySuccessMarkdown } from './success-markdown';
export function SurveyCollectionSettingsEditor({markdown,locked,onChange}:{markdown:string;locked:boolean;onChange:(value:string)=>void}) {
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
  return <section aria-label="限答与成功页设置" className="space-y-4 rounded-lg border border-border bg-card p-5">
    <h2 className="text-16 font-semibold">回收设置</h2>
    <fieldset disabled={locked} className="space-y-4">
      <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={settings.responseLimitScope==='browser'} onChange={event=>update({...settings,responseLimitScope:event.target.checked?'browser':'none'})}/>同一浏览器限答一次</label>
      <p className="text-12 text-muted-foreground">保持匿名；清除 Cookie 或更换浏览器、设备后可再次填写，不保证跨设备唯一。</p>
      <label className="block space-y-2 text-13">成功页 Markdown<textarea aria-label="成功页 Markdown" maxLength={10000} value={settings.successMessageMarkdown} onChange={event=>update({...settings,successMessageMarkdown:event.target.value})} className="block min-h-28 w-full rounded-md border border-border bg-background p-3 font-mono"/></label>
    </fieldset>
    {(!parsed.ok || !SurveyCollectionSettingsSchema.safeParse(settings).success) && <p role="alert" className="text-12 text-destructive">请填写有效成功页内容（最多 10000 字符）。</p>}
    <details><summary className="cursor-pointer text-13">预览成功页</summary><div className="mt-3 rounded-md border border-border p-4"><SurveySuccessMarkdown markdown={settings.successMessageMarkdown}/></div></details>
    {locked && <p className="text-12 text-muted-foreground">这些设置随发布版本冻结；复制为新草稿后可调整，不会改变旧链接。</p>}
  </section>;
}
