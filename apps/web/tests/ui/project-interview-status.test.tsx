import {expect,it} from 'vitest';
import {render,screen} from '@testing-library/react';
import {FileText} from 'lucide-react';
import {ProjectContentCard} from '@/components/project/project-content-card';
import {I18nProvider} from '@/lib/i18n/provider';
it.each([['zh-CN','已完成','待确认主题','已归档'],['en','Completed','Topic awaiting confirmation','Archived']] as const)('localizes project interview status in %s', (locale,completed,pending,archived)=>{
 const card=(status:string)=><I18nProvider initialLocale={locale}><ProjectContentCard href="/itv/example" linkTestId="study" title="Study" typeLabel="Interview" icon={FileText} resourceKind="interview" status={status}/></I18nProvider>;
 const view=render(card('completed'));expect(screen.getByText(completed)).toBeVisible();
 view.rerender(card('topic_pending'));expect(screen.getByText(pending)).toBeVisible();expect(screen.queryByText('topic_pending')).toBeNull();
 view.rerender(card('archived'));expect(screen.getByText(archived)).toBeVisible();
});

it.each([["zh-CN", "草稿", "待发布"], ["en", "Draft", "Ready to publish"]] as const)("localizes known survey authoring statuses without guessing publication in %s", (locale, draft, ready) => {
 const card=(status:string)=><I18nProvider initialLocale={locale}><ProjectContentCard href="/studio/survey/example" linkTestId="study" title="Study" typeLabel="Survey" icon={FileText} resourceKind="survey" status={status}/></I18nProvider>;
 const view=render(card("draft"));expect(screen.getByText(draft)).toBeVisible();
 view.rerender(card("ready"));expect(screen.getByText(ready)).toBeVisible();
 view.rerender(card("unknown_future_state"));expect(screen.queryByText("unknown_future_state")).toBeNull();
});
