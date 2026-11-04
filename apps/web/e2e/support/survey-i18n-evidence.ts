import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import type { SurveyLibraryTemplate } from "@repo/contracts/survey-template-library";
export type SurveyI18nDatabaseEvidence = Pick<SurveyRuntime, "id" | "version" | "answerRevision" | "title" | "questions" | "template" | "activeCollectionBatchId" | "responses" | "report"> & {
  sourceHash?: string;
  publication: { version: number; status: string; questions: SurveyRuntime["questions"]; sourceHash?: string } | null;
  batches?: { id: string; version: number; sourceHash?: string }[];
  attachments: { id: string; response_id: string; question_id: string; name: string; mime: string; size_bytes: number; sha256: string; status: string }[];
  uploadSessions: { submission_id: string; response_id: string; publication_version: number }[];
  templates: SurveyLibraryTemplate[];
};
/** Only the pre-existing Survey R1 fixture prefix can be inspected by the read-only script. */
export function surveyI18nDatabaseEvidence(fixtureUserId: string, surveyId: string, templateIds: string[] = []): SurveyI18nDatabaseEvidence {
  const prefix = "survey-r1-6118-";
  if (!fixtureUserId.startsWith(prefix)) throw Error("owned_survey_fixture_required");
  const stdout = execFileSync("pnpm", ["--filter", "@repo/api", "exec", "tsx", "scripts/survey-i18n-evidence.ts"], {
    cwd: resolve(__dirname, "../../../.."), encoding: "utf8", env: process.env, timeout: 60_000,
    input: JSON.stringify({ fixtureId: fixtureUserId.slice(prefix.length), surveyId, templateIds }), stdio: ["pipe", "pipe", "pipe"],
  });
  const payload = stdout.split("__SURVEY_I18N_EVIDENCE__")[1]?.trim();
  if (!payload) throw Error("survey_i18n_evidence_missing");
  return JSON.parse(payload) as SurveyI18nDatabaseEvidence;
}
