import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { importSkillStarterPack, SkillStarterImportAdminRequiredError, SkillStarterPackConflictError } from '../../src/application/skill-import/import-skill-starter-pack';
import type { SkillStarterImportRepository, SkillStarterImportResult } from '../../src/application/skill-import/ports';
import { PLATFORM_ORG_ID, toOrgId } from '../../src/domain/org-id';
import { verifySkillStarterPack } from '../../src/domain/skill/starter-pack';
import { AIDT_PLATFORM_SKILL_PACK } from '../../src/infrastructure/aidt/aidt-module';
import { PgIdentityRepository } from '../../src/infrastructure/identity/pg-identity-repository';

const raw = JSON.parse(readFileSync(new URL(`../../../../skills/starter-packs/${AIDT_PLATFORM_SKILL_PACK.packId}/${AIDT_PLATFORM_SKILL_PACK.packVersion}.json`, import.meta.url), 'utf8')) as unknown;
const pack = verifySkillStarterPack(raw, AIDT_PLATFORM_SKILL_PACK);
const input = { ...AIDT_PLATFORM_SKILL_PACK, actorId: 'unit-platform-actor', orgId: toOrgId(PLATFORM_ORG_ID), idempotencyKey: `platform-builtin:${AIDT_PLATFORM_SKILL_PACK.packId}:${AIDT_PLATFORM_SKILL_PACK.packVersion}` };
const result: SkillStarterImportResult = { importId: 'unit-import', ...AIDT_PLATFORM_SKILL_PACK, packDigest: pack.packDigest, status: 'succeeded', skillIds: pack.skills.map((skill) => 'unit-' + skill.stableName), versionIds: pack.skills.map((skill) => 'unit-version-' + skill.stableName), importedAt: '2026-11-15T00:00:00Z' };
function setup() {
  const db: DatabasePort = {
    withTenant: vi.fn(async () => { throw new Error('No DB in this unit lane'); }),
    withoutTenant: vi.fn(async () => { throw new Error('No DB in this unit lane'); }),
    close: vi.fn(async () => { throw new Error('No DB in this unit lane'); }),
  };
  const identities = new PgIdentityRepository(db);
  vi.spyOn(identities, 'findOrgMembership').mockResolvedValue({ orgRole: 'admin', teamId: null });
  const imports: SkillStarterImportRepository = {
    findExisting: vi.fn(async () => ({ kind: 'missing' as const })),
    persistVerified: vi.fn(async () => ({ kind: 'created' as const, result })),
    retireSuperseded: vi.fn(async () => []),
    recordFailure: vi.fn(async () => ({ kind: 'previous-failure' as const, failureCode: 'UNEXPECTED_IN_UNIT' })),
  };
  const packs = { load: vi.fn(async () => raw) };
  return { db, identities, packs, imports };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('actual AIDT importer with in-memory persistence ports', () => {
  it('replays a fixed verified release without creating another version', async () => {
    const deps = setup();
    vi.mocked(deps.imports.findExisting).mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({ kind: 'replayed', result });
    const first = await importSkillStarterPack(deps, input);
    const second = await importSkillStarterPack(deps, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.result).toEqual(first.result);
    expect(deps.imports.persistVerified).toHaveBeenCalledOnce();
    expect(deps.imports.persistVerified).toHaveBeenCalledWith(expect.objectContaining({ orgId: PLATFORM_ORG_ID, pack: expect.objectContaining({ packDigest: pack.packDigest }) }));
    expect(deps.imports.retireSuperseded).toHaveBeenCalledWith({ orgId: PLATFORM_ORG_ID, packId: AIDT_PLATFORM_SKILL_PACK.packId, keepStableNames: pack.skills.map((skill) => skill.stableName) });
    expect(deps.db.withTenant).not.toHaveBeenCalled();
    expect(deps.db.withoutTenant).not.toHaveBeenCalled();
  });
  it('keeps conflicting user content a visible conflict instead of forcing an overwrite or retirement', async () => {
    const deps = setup();
    vi.mocked(deps.imports.persistVerified).mockResolvedValue({ kind: 'name-conflict' });
    await expect(importSkillStarterPack(deps, input)).rejects.toBeInstanceOf(SkillStarterPackConflictError);
    expect(deps.imports.persistVerified).toHaveBeenCalledOnce();
    expect(deps.imports.retireSuperseded).not.toHaveBeenCalled();
    expect(deps.imports.recordFailure).not.toHaveBeenCalled();
  });
  it('does not treat the module enable flag as authority to import without membership', async () => {
    const deps = setup();
    vi.mocked(deps.identities.findOrgMembership).mockResolvedValue(null);
    await expect(importSkillStarterPack(deps, input)).rejects.toBeInstanceOf(SkillStarterImportAdminRequiredError);
    expect(deps.packs.load).not.toHaveBeenCalled();
    expect(deps.imports.findExisting).not.toHaveBeenCalled();
    expect(deps.imports.persistVerified).not.toHaveBeenCalled();
  });
});
