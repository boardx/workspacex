// @global-scope-fixture seeder:ensureStandardSkillPacksSeeded: Mocked importer; the DatabasePort throws if touched, so no platform rows are written or require cleanup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { importSkillStarterPack } from '../../src/application/skill-import/import-skill-starter-pack';
import { PLATFORM_ORG_ID } from '../../src/domain/org-id';
import { AIDT_PLATFORM_SKILL_PACK, AIDT_SUMMARY_SKILL_PACK, AIDT_OPT_IN_SKILL_PACKS, parseAidtModuleEnabled } from '../../src/infrastructure/aidt/aidt-module';
import { enabledPlatformSkillPacks, ensureStandardSkillPacksSeeded, STANDARD_PLATFORM_PACKS } from '../../src/infrastructure/skill/ensure-standard-skill-packs';

vi.mock('../../src/application/skill-import/import-skill-starter-pack', () => ({ importSkillStarterPack: vi.fn() }));
const importer = vi.mocked(importSkillStarterPack);
const noDatabase: DatabasePort = {
  withTenant: vi.fn(async () => { throw new Error('This unit lane must not access a database'); }),
  withoutTenant: vi.fn(async () => { throw new Error('This unit lane must not access a database'); }),
  close: vi.fn(async () => { throw new Error('This unit lane does not own a database'); }),
};
const imported = {
  created: true,
  result: { importId: 'unit-import', packId: 'aidt-methods', packVersion: AIDT_PLATFORM_SKILL_PACK.packVersion, packDigest: 'a'.repeat(64), status: 'succeeded' as const, skillIds: ['unit-skill'], versionIds: ['unit-version'], importedAt: '2026-11-15T00:00:00Z' },
  retiredSkillIds: [],
};

beforeEach(() => {
  vi.stubEnv('ENABLE_AIDT_MODULE', undefined);
  vi.clearAllMocks();
  importer.mockReset();
  importer.mockResolvedValue(imported);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('default AIDT bootstrap boundary (mock importer, no DB)', () => {
  it.each([undefined, '', '0', 'false', 'TRUE', 'yes', ' true ', 'enabled'])('is available with legacy value %j', value => {
    expect(parseAidtModuleEnabled(value)).toBe(true);
  });
  it.each(['1', 'true'])('accepts explicit opt-in %j', value => {
    expect(parseAidtModuleEnabled(value)).toBe(true);
  });
  it('includes AIDT at default startup even with an old disabled environment flag', async () => {
    for (const value of [undefined, '0', 'false', '1']) {
      vi.stubEnv('ENABLE_AIDT_MODULE', value);
      expect(enabledPlatformSkillPacks()).toEqual([...AIDT_OPT_IN_SKILL_PACKS, ...STANDARD_PLATFORM_PACKS]);
    }
    const reports = await ensureStandardSkillPacksSeeded(noDatabase, 'actor');
    expect(reports.map(report => report.packId)).toEqual([...AIDT_OPT_IN_SKILL_PACKS, ...STANDARD_PLATFORM_PACKS].map(pack => pack.packId));
    expect(noDatabase.withTenant).not.toHaveBeenCalled();
  });
  it('imports an explicit AIDT list without deployment opt-in', async () => {
    const reports = await ensureStandardSkillPacksSeeded(noDatabase, 'actor', AIDT_OPT_IN_SKILL_PACKS);
    expect(reports.map(report => report.packId)).toEqual(AIDT_OPT_IN_SKILL_PACKS.map(pack => pack.packId));
  });
  it('uses the canonical platform importer and the same stable replay identity when enabled', async () => {
    vi.stubEnv('ENABLE_AIDT_MODULE', 'true');
    await ensureStandardSkillPacksSeeded(noDatabase, 'actor', [AIDT_PLATFORM_SKILL_PACK]);
    importer.mockResolvedValueOnce({ ...imported, created: false });
    const replay = await ensureStandardSkillPacksSeeded(noDatabase, 'actor', [AIDT_PLATFORM_SKILL_PACK]);
    const inputs = importer.mock.calls.map(([, input]) => input);
    expect(inputs).toEqual(Array.from({ length: 2 }, () => ({ actorId: 'actor', orgId: PLATFORM_ORG_ID, ...AIDT_PLATFORM_SKILL_PACK, idempotencyKey: `platform-builtin:${AIDT_PLATFORM_SKILL_PACK.packId}:${AIDT_PLATFORM_SKILL_PACK.packVersion}` })));
    expect(replay[0]?.created).toBe(false);
    expect(noDatabase.withTenant).not.toHaveBeenCalled();
    expect(noDatabase.withoutTenant).not.toHaveBeenCalled();
  });
  it('keeps AIDT import failure separate from ordinary platform packs', async () => {
    vi.stubEnv('ENABLE_AIDT_MODULE', '1');
    importer.mockRejectedValueOnce(new Error('unit AIDT pack failure'));
    const reports = await ensureStandardSkillPacksSeeded(noDatabase, 'actor');
    expect(reports[0]).toMatchObject({ ...AIDT_PLATFORM_SKILL_PACK, ok: false });
    expect(reports[1]).toMatchObject({ ...AIDT_SUMMARY_SKILL_PACK, ok: true });
    expect(reports.slice(AIDT_OPT_IN_SKILL_PACKS.length).map(report => report.packId)).toEqual(STANDARD_PLATFORM_PACKS.map(pack => pack.packId));
    expect(reports.slice(1).every(report => report.ok)).toBe(true);
  });
});
