import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { SkillStarterPack } from "../../domain/skill/starter-pack";

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
