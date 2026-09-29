export type SurveyDestination = "import" | "design" | "publish" | "responses" | "report" | "template";

export function surveyPath(id: string, destination: SurveyDestination): string {
  return `/studio/survey/${encodeURIComponent(id)}/${destination}`;
}
