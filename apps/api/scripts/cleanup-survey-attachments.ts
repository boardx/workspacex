/** Run for each managed tenant: pnpm --filter @repo/api exec tsx scripts/cleanup-survey-attachments.ts <orgId>.
 * Only expired, unclaimed survey objects can be deleted; retries are idempotent.
 */
import { createApp } from "../src/main";
import {
  SURVEY_ATTACHMENT_SERVICE,
  type SurveyAttachmentService,
} from "../src/application/survey/survey-attachment-service";
import { toOrgId } from "../src/domain/org-id";
const orgId = process.argv[2];
if (!orgId) throw new Error("orgId required");
const app = await createApp();
try {
  const service = app.get<SurveyAttachmentService>(SURVEY_ATTACHMENT_SERVICE);
  let count: number;
  let total = 0;
  do {
    count = await service.cleanup(toOrgId(orgId));
    total += count;
  } while (count === 100);
  console.log(JSON.stringify({ removed: total }));
} finally {
  await app.close();
}
