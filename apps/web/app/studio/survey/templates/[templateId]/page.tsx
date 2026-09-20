import { SurveyTemplateWorkspace } from "@/components/survey/library/template-workspace";
import { SurveyTemplateEditorShell } from '@/components/survey/templates/survey-template-editor-shell';
export default function SurveyTemplateEditorPage({params,searchParams}:{params:{templateId:string};searchParams:{preview?:string}}){
 if(searchParams.preview!=="1") return <SurveyTemplateWorkspace templateId={params.templateId} kind="report" />;
 return <SurveyTemplateEditorShell templateId={params.templateId}/>;
}
