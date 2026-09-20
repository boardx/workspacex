import { SurveyTemplateWorkspace } from "@/components/survey/library/template-workspace";
export default function QuestionTemplatePage({ params }: { params: { templateId: string } }) {
  return <SurveyTemplateWorkspace templateId={params.templateId} kind="question" />;
}
