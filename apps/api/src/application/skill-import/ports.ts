import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { SkillStarterPack } from "../../domain/skill/starter-pack";
import type { WorkSkillManifest } from "@repo/contracts/work-skill-meta";

export type SkillStarterImportResult = z.infer<typeof wave2Runtime.SkillStarterImportResult>;

export interface SkillStarterPackSource {
  load(packId: string, packVersion: string): Promise<unknown | null>;
}

export const SKILL_STARTER_PACK_SOURCE = Symbol("SkillStarterPackSource");

export type PersistVerifiedImportOutcome =
  | { readonly kind: "created"; readonly result: SkillStarterImportResult }
  | { readonly kind: "replayed"; readonly result: SkillStarterImportResult }
  | { readonly kind: "name-conflict" }
  /**
   * 发货包改了某个 skill 的正文却没有 bump 它自己的 `semanticVersion`。
   * `skill_versions_semantic_uniq` 会拒绝这次写入——把它折成一个具名结果，
   * 让调用方（和日志）看到的是「哪个 skill 的哪个版本号被重用了」，
   * 而不是一条裸的 23505。
   */
  | { readonly kind: "version-label-reused"; readonly stableName: string; readonly semanticVersion: string }
  | { readonly kind: "idempotency-conflict" }
  /** WS02（E2）：manifest 的 stableId 已属于本组织另一个 Skill 的目录行。整包回滚。 */
  | { readonly kind: "stable-id-conflict"; readonly stableId: string; readonly conflictingSkillId: string }
  | { readonly kind: "previous-failure"; readonly failureCode: string };

export type ExistingImportOutcome =
  | { readonly kind: "missing" }
  | { readonly kind: "replayed"; readonly result: SkillStarterImportResult }
  | { readonly kind: "idempotency-conflict" }
  | { readonly kind: "previous-failure"; readonly failureCode: string };

export interface SkillStarterImportRepository {
  findExisting(input: {
    readonly orgId: OrgId;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
  }): Promise<ExistingImportOutcome>;

  persistVerified(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
    readonly pack: SkillStarterPack;
    /**
     * WS02：已校验的 `metadata.work`，按 stableName 索引（无该键的普通 Skill 不在表内）。
     * 与 skill 行、版本行**同一事务**写入 `skill_versions.manifest.work` 并 upsert
     * `skill_catalog_entries`（新行 channel=candidate；已有行只刷新检索字段，不回退通道）。
     */
    readonly workManifests?: ReadonlyMap<string, WorkSkillManifest>;
  }): Promise<PersistVerifiedImportOutcome>;

  /**
   * 下线**这个包上一版装进来、这一版已经不再发货**的 skill（issue #3733）。
   *
   * 判据与升级路径同源——只认血统：`starter_pack_imports` 里本 org、同 `pack_id`、
   * `status='succeeded'` 的导入所铸出的 `skillIds`，其中 `stable_name` 不在
   * `keepStableNames` 里且仍 `status='enabled'` 的行 ⇒ `skills.status='disabled'` +
   * `capability_listings.enabled=false`（与 `PgCapabilityRepository.setEnabled` 写同两张表）。
   * 用户自建 / URL 导入 / 别的包的同名 skill 从不在任何导入的 `skillIds` 里，碰不到。
   *
   * 幂等：已经 `disabled` 的行不再匹配，重复调用返回空数组。返回本次真正下线的 skill id。
   */
  retireSuperseded(input: {
    readonly orgId: OrgId;
    readonly packId: string;
    readonly keepStableNames: readonly string[];
  }): Promise<readonly string[]>;

  recordFailure(input: {
    readonly orgId: OrgId;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly payloadDigest: string;
    readonly packId: string;
    readonly packVersion: string;
    readonly packDigest: string | null;
    readonly failureCode: string;
  }): Promise<Exclude<ExistingImportOutcome, { readonly kind: "missing" }>>;
}

export const SKILL_STARTER_IMPORT_REPOSITORY = Symbol("SkillStarterImportRepository");
