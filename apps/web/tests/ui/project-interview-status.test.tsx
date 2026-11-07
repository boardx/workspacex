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
