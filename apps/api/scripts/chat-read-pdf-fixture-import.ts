/** Candidate for apps/api/scripts/chat-read-pdf-fixture-import.ts. No DB call at import time. */
import { wave2Runtime } from "@repo/contracts";
import { createHash } from "node:crypto";
import { importSkillStarterPack } from "../src/application/skill-import/import-skill-starter-pack";
import type { ImportSkillStarterPackDeps } from "../src/application/skill-import/import-skill-starter-pack";
import type { SkillStarterPack } from "../src/domain/skill/starter-pack";
import type { OrgId } from "../src/domain/org-id";
import type { DatabasePort } from "../src/application/ports/database.port";
import { OFFICIAL_SKILLS } from "../src/infrastructure/skill/ensure-platform-skill-catalog";
import { officeSkillPackage } from "./office-skill-packages";

const PACK_ID = "chat-read-pdf-fixture";
const PACK_VERSION = "1.0.0";

export function chatReadPdfFixturePack(): SkillStarterPack {
  const specs = OFFICIAL_SKILLS.filter(spec => spec.stableName === "pdf-create");
  if (specs.length !== 1) throw new Error("CHAT_FIXTURE_PDF_SOURCE_UNAVAILABLE");
  const spec = specs[0]!;
  // Reuse shipped source files only. Platform skill/version IDs are not imported.
  const files = officeSkillPackage(spec).package.files;
  const unsigned = wave2Runtime.UnsignedSkillStarterPack.parse({
    schemaVersion: 1 as const,
    packId: PACK_ID,
    packVersion: PACK_VERSION,
    skills: [{
      stableName: spec.stableName,
      name: spec.displayName,
      semanticVersion: PACK_VERSION,
      manifest: {},
      files,
    }],
  });
  return { ...unsigned, packDigest: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") };
}

export async function importChatReadPdfFixture(
  deps: Omit<ImportSkillStarterPackDeps, "packs">,
  input: { orgId: OrgId; actorId: string },
  db: DatabasePort,
): Promise<{ skillId: string; versionId: string; packDigest: string }> {
  const pack = chatReadPdfFixturePack();
  const outcome = await importSkillStarterPack({
    ...deps,
    packs: { load: async (id, version) => id === PACK_ID && version === PACK_VERSION ? pack : null },
  }, {
    ...input,
    packId: PACK_ID,
    packVersion: PACK_VERSION,
    idempotencyKey: `chat-read-fixture:${PACK_ID}:${PACK_VERSION}`,
  });
  const result = outcome.result;
  if (result.packDigest !== pack.packDigest || result.skillIds.length !== 1 || result.versionIds.length !== 1) {
    throw new Error("CHAT_FIXTURE_PDF_RECEIPT_INVALID");
  }
  const owned = await db.withTenant(input.orgId, async session => session.query(
    "SELECT v.id FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.org_id=s.org_id WHERE s.org_id=$1 AND s.id=$2 AND s.stable_name='pdf-create' AND s.status='enabled' AND v.id=$3 AND v.published=true",
    [input.orgId, result.skillIds[0], result.versionIds[0]],
  ));
  if (owned.rows.length !== 1) throw new Error("CHAT_FIXTURE_PDF_RECEIPT_NOT_SAME_TENANT");
  return { skillId: result.skillIds[0]!, versionId: result.versionIds[0]!, packDigest: result.packDigest };
}
