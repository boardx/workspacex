import { fileURLToPath } from 'node:url';
import type { DatabasePort } from '../../application/ports/database.port';
import { importSkillStarterPack } from '../../application/skill-import/import-skill-starter-pack';
import { PLATFORM_ORG_ID, toOrgId } from '../../domain/org-id';
import { PgIdentityRepository } from '../identity/pg-identity-repository';
import { FileSkillStarterPackSource } from './file-skill-starter-pack-source';
import { PgSkillStarterImportRepository } from './pg-skill-starter-import-repository';

/** Shipped release manifests, not model-selected paths or mutable remote candidates. */
export const STANDARD_PLATFORM_PACKS = [
  {packId:'standard-web',packVersion:'1.1.2'},
  {packId:'data-workflows',packVersion:'1.0.0'},
  {packId:'standard-methods',packVersion:'1.0.1'},
  {packId:'standard-context',packVersion:'1.1.0'},
  {packId:'standard-canvas',packVersion:'1.0.0'},
  {packId:'standard-document',packVersion:'1.2.0'},
  {packId:'standard-authoring',packVersion:'1.0.0'},
  {packId:'standard-visual',packVersion:'1.0.1'},
  {packId:'standard-audio',packVersion:'1.1.1'},
] as const;
/**
 * 一个包炸掉，**不许**让后面的包收不到。
 *
 * ## 这是独立缺陷，不是升级路径的附属品
 *
 * 真实 Postgres 实测（全新库，把第一项 `standard-web` 指向一个不存在的版本
 * `9.9.9` 让它必然失败）：`starter_pack_imports` 里**只有一行**
 * `platform-builtin:standard-web:9.9.9`，其余八个包**零行**——第一个包抛出来的
 * 异常直接把整个 for 循环掀了，`ensurePlatformSkillCatalogSeeded` 的外层 catch
 * 把它折成 `{ok:false}`，日志里看到的是「种子失败」这一句笼统的话，而实际后果是
 * **九个包一个都没进去**。`standard-web` 恰好排在第一项，所以任何让它失败的原因
 * （版本写错、包文件损坏、名字撞了……）都等价于「全部标准 skill 集体消失」。
 *
 * per-pack 边界让爆炸半径回到它应有的大小：失败的那个包记成 `failed` 并带上原因，
 * 其余八个照常导入。返回值里如实带上每个包的成败，调用方决定怎么记日志——
 * 这里不吞掉任何东西，只是不让一个包的失败替其它八个包做决定。
 */
export interface StandardPackSeedOutcome {
  readonly packId: string;
  readonly packVersion: string;
  readonly ok: boolean;
  readonly created?: boolean;
  readonly result?: Awaited<ReturnType<typeof importSkillStarterPack>>["result"];
  readonly error?: unknown;
}

export async function ensureStandardSkillPacksSeeded(
  db: DatabasePort,
  actorId: string,
  packs: readonly { readonly packId: string; readonly packVersion: string }[] = STANDARD_PLATFORM_PACKS,
): Promise<readonly StandardPackSeedOutcome[]> {
  const source = new FileSkillStarterPackSource(fileURLToPath(new URL('../../../../../skills/starter-packs/', import.meta.url)));
  const deps = { identities: new PgIdentityRepository(db), packs: source, imports: new PgSkillStarterImportRepository(db) };
  const reports: StandardPackSeedOutcome[] = [];
  for (const pack of packs) {
    try {
      const outcome = await importSkillStarterPack(deps, {
        actorId,
        orgId: toOrgId(PLATFORM_ORG_ID),
        ...pack,
        idempotencyKey: `platform-builtin:${pack.packId}:${pack.packVersion}`,
      });
      reports.push({ ...pack, ok: true, ...outcome });
    } catch (error) {
      reports.push({ ...pack, ok: false, error });
    }
  }
  return reports;
}
