/** Read-only evidence for the owned disposable Survey R1 fixture, never a runtime route. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { SurveyLibraryTemplateSchema } from "@repo/contracts/survey-template-library";
import { assertIsolatedDatabase } from "../../../.harness/scripts/lib/test-isolation";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { asOwner } from "../tests/support/db";
const Input = z.object({ fixtureId: z.string().uuid(), surveyId: z.string().uuid(), templateIds: z.array(z.string().uuid()).max(10).default([]) }).strict();
async function main() {
  assertIsolatedDatabase({ resolvedDatabase: migrationConfig().database ?? "", env: process.env });
  if (!process.env.WORKSPACEX_ISOLATION_ID) throw Error("isolated_fullstack_required");
  const input = Input.parse(JSON.parse(readFileSync(0, "utf8")));
  const ownerId = `survey-r1-6118-${input.fixtureId}`, orgId = `local-${ownerId}`;
  const evidence = await asOwner(async client => {
    const records = await client.query<{ document: { model: unknown } }>("SELECT document FROM survey_workspaces WHERE org_id=$1 AND owner_id=$2 AND id=$3", [orgId, ownerId, input.surveyId]);
    if (records.rows.length !== 1) throw Error("owned_survey_missing");
    const model = SurveyRuntimeSchema.parse(records.rows[0]!.document.model);
    const attachments = await client.query("SELECT id,response_id,question_id,name,mime,size_bytes,sha256,status FROM survey_attachments WHERE org_id=$1 AND survey_id=$2 ORDER BY id", [orgId, input.surveyId]);
    const sessions = await client.query("SELECT submission_id,response_id,publication_version FROM survey_upload_sessions WHERE org_id=$1 AND survey_id=$2 ORDER BY submission_id", [orgId, input.surveyId]);
    const templates = await client.query<{ document: unknown }>("SELECT document FROM survey_library_templates WHERE org_id=$1 AND owner_id=$2 AND id=ANY($3::text[]) ORDER BY id", [orgId, ownerId, input.templateIds]);
    return {
      id: model.id, version: model.version, answerRevision: model.answerRevision,
      title: model.title, questions: model.questions, template: model.template,
      sourceHash: model.source?.contentHash, activeCollectionBatchId: model.activeCollectionBatchId,
      publication: model.publication ? { version: model.publication.version, status: model.publication.status, questions: model.publication.questions, sourceHash: model.publication.sourceSnapshot?.contentHash } : null,
      batches: model.collectionBatches?.map(batch => ({ id: batch.id, version: batch.version, sourceHash: batch.sourceSnapshot?.contentHash })),
      responses: model.responses, report: model.report,
      attachments: attachments.rows, uploadSessions: sessions.rows,
      templates: templates.rows.map(row => SurveyLibraryTemplateSchema.parse(row.document)),
    };
  });
  // Excludes session capability tokens/hashes, publication tokens and browser-proof secrets.
  console.log(`__SURVEY_I18N_EVIDENCE__${JSON.stringify(evidence)}`);
}
main().catch(() => { console.error("Isolated survey i18n evidence failed."); process.exitCode = 1; });
