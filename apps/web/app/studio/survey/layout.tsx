import { SurveyAppShell } from "@/components/survey/shell/survey-app-shell";

export default function SurveyLayout({ children }: { children: React.ReactNode }) {
  return <SurveyAppShell>{children}</SurveyAppShell>;
}
