import { SurveyTemplateEditorShell } from "@/components/survey/templates/survey-template-editor-shell";

export default function SurveyTemplateEditorPage({ params }: { params: { templateId: string } }) {
  return <SurveyTemplateEditorShell templateId={params.templateId} />;
}
