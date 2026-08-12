import { redirect } from "next/navigation";

export default function SurveyPage() {
  redirect("/studio/survey/sv-1?step=design");
}
