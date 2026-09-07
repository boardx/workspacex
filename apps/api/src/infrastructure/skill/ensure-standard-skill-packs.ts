import { fileURLToPath } from 'node:url';
import type { DatabasePort } from '../../application/ports/database.port';
import { importSkillStarterPack } from '../../application/skill-import/import-skill-starter-pack';
import { PLATFORM_ORG_ID, toOrgId } from '../../domain/org-id';
import { PgIdentityRepository } from '../identity/pg-identity-repository';
import { FileSkillStarterPackSource } from './file-skill-starter-pack-source';
import { PgSkillStarterImportRepository } from './pg-skill-starter-import-repository';

/** Shipped release manifests, not model-selected paths or mutable remote candidates. */
export const STANDARD_PLATFORM_PACKS = [
  {packId:'standard-web',packVersion:'1.0.0'},
  {packId:'data-workflows',packVersion:'1.0.0'},
  {packId:'standard-methods',packVersion:'1.0.0'},
  {packId:'standard-context',packVersion:'1.0.0'},
  {packId:'standard-canvas',packVersion:'1.0.0'},
] as const;
export async function ensureStandardSkillPacksSeeded(db:DatabasePort, actorId:string) {
  const packs=new FileSkillStarterPackSource(fileURLToPath(new URL('../../../../../skills/starter-packs/',import.meta.url)));
  const deps={identities:new PgIdentityRepository(db),packs,imports:new PgSkillStarterImportRepository(db)};
  const reports=[];
  for(const pack of STANDARD_PLATFORM_PACKS) {
    const outcome=await importSkillStarterPack(deps,{actorId,orgId:toOrgId(PLATFORM_ORG_ID),...pack,
      idempotencyKey:`platform-builtin:${pack.packId}:${pack.packVersion}`});
    reports.push({packId:pack.packId,packVersion:pack.packVersion,...outcome});
  }
  return reports;
}
