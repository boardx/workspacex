import { redirect } from 'next/navigation';
import { SurveyTemplateEditorShell } from '@/components/survey/templates/survey-template-editor-shell';
export default function SurveyTemplateEditorPage({params,searchParams}:{params:{templateId:string};searchParams:{preview?:string}}){
 if(searchParams.preview!=='1')redirect('/studio/survey');
 return <SurveyTemplateEditorShell templateId={params.templateId}/>;
}
