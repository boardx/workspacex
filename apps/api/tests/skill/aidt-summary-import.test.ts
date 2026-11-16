// @global-scope-fixture importer:importSkillStarterPack: In-memory identity/persistence ports; DatabasePort rejects every access, no platform row is written.
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { importSkillStarterPack, SkillStarterImportAdminRequiredError, SkillStarterPackConflictError } from "../../src/application/skill-import/import-skill-starter-pack";
import type { SkillStarterImportRepository, SkillStarterImportResult } from "../../src/application/skill-import/ports";
import { PLATFORM_ORG_ID, toOrgId } from "../../src/domain/org-id";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { AIDT_SUMMARY_SKILL_PACK } from "../../src/infrastructure/aidt/aidt-module";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
const raw=JSON.parse(readFileSync(new URL(`../../../../skills/starter-packs/${AIDT_SUMMARY_SKILL_PACK.packId}/${AIDT_SUMMARY_SKILL_PACK.packVersion}.json`,import.meta.url),"utf8"));
const pack=verifySkillStarterPack(raw,AIDT_SUMMARY_SKILL_PACK);
const input={...AIDT_SUMMARY_SKILL_PACK,actorId:"unit-platform-admin",orgId:toOrgId(PLATFORM_ORG_ID),idempotencyKey:`platform-builtin:${pack.packId}:${pack.packVersion}`};
const result:SkillStarterImportResult={importId:"summary-import",...AIDT_SUMMARY_SKILL_PACK,packDigest:pack.packDigest,status:"succeeded",skillIds:["summary-skill"],versionIds:["summary-version"],importedAt:"2026-11-16T00:00:00Z"};
function setup(){
  const db:DatabasePort={withTenant:vi.fn(async()=>{throw new Error("No DB in summary unit test");}),withoutTenant:vi.fn(async()=>{throw new Error("No DB in summary unit test");}),close:vi.fn(async()=>{throw new Error("No DB owned");})};
  const identities=new PgIdentityRepository(db);vi.spyOn(identities,"findOrgMembership").mockResolvedValue({orgRole:"admin",teamId:null});
  const imports:SkillStarterImportRepository={findExisting:vi.fn(async()=>({kind:"missing" as const})),persistVerified:vi.fn(async()=>({kind:"created" as const,result})),retireSuperseded:vi.fn(async()=>[]),recordFailure:vi.fn(async()=>({kind:"previous-failure" as const,failureCode:"UNEXPECTED"}))};
  return {db,identities,imports,packs:{load:vi.fn(async()=>raw)}};
}
afterEach(()=>vi.restoreAllMocks());
it("uses the existing authorized importer and immutable replay identity for the real summary capability",async()=>{
  const deps=setup();vi.mocked(deps.imports.findExisting).mockResolvedValueOnce({kind:"missing"}).mockResolvedValueOnce({kind:"replayed",result});
  const created=await importSkillStarterPack(deps,input),replayed=await importSkillStarterPack(deps,input);
  expect(created.created).toBe(true);expect(replayed.created).toBe(false);expect(replayed.result).toEqual(created.result);
  expect(deps.imports.persistVerified).toHaveBeenCalledOnce();expect(deps.imports.persistVerified).toHaveBeenCalledWith(expect.objectContaining({orgId:PLATFORM_ORG_ID,pack:expect.objectContaining({skills:[expect.objectContaining({stableName:"dt-summarize-project"})]})}));
  expect(deps.imports.retireSuperseded).toHaveBeenCalledWith({orgId:PLATFORM_ORG_ID,packId:pack.packId,keepStableNames:["dt-summarize-project"]});
  expect(deps.db.withTenant).not.toHaveBeenCalled();expect(deps.db.withoutTenant).not.toHaveBeenCalled();
});
it("does not use an opt-in flag to bypass actual platform administrator membership",async()=>{
  const deps=setup();vi.mocked(deps.identities.findOrgMembership).mockResolvedValue(null);
  await expect(importSkillStarterPack(deps,input)).rejects.toBeInstanceOf(SkillStarterImportAdminRequiredError);
  expect(deps.packs.load).not.toHaveBeenCalled();expect(deps.imports.persistVerified).not.toHaveBeenCalled();
});
it("keeps an existing same-name user/other-lineage skill a conflict, without overwriting or retiring it",async()=>{
  const deps=setup();vi.mocked(deps.imports.persistVerified).mockResolvedValue({kind:"name-conflict"});
  await expect(importSkillStarterPack(deps,input)).rejects.toBeInstanceOf(SkillStarterPackConflictError);
  expect(deps.imports.retireSuperseded).not.toHaveBeenCalled();expect(deps.imports.recordFailure).not.toHaveBeenCalled();
});
