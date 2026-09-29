import type { z } from "zod";
import type { wave2Runtime } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { SkillStarterPack } from "../../domain/skill/starter-pack";
import type { WorkSkillManifest } from "@repo/contracts/work-skill-meta";
import type { WorkGateStatus } from "@repo/contracts/work-eval";

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
    /**
     * 导入时由门脚本同一判定函数算出的 `WorkGateStatus`（按 stableName 索引，见 `StarterPackGateJudge`）。
     * 同一事务写入 `skill_gate_records`，但**只补不盖**：该版本已有记录（平台运营回写的完整评测）则保持原样。
     */
    readonly gateStatuses?: ReadonlyMap<string, WorkGateStatus>;
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

/**
 * 导入时的门判定（契约束 work-eval：门状态只来自门脚本产出的 `WorkGateStatus`，I-9）。
 *
 * 实现复用 `lint-work-stack-gates` 的**同一个**判定函数 `judgeWorkStackGates`，被测版本 digest 取本次
 * 导入落库的版本（`sha256:` + `skill_versions.content_digest`），因此结果与目录里的版本一一对应。
 * 能在导入时确定的门（G0 身份 / G1 溯源许可 / G2 schema / G3 依赖登记与套件覆盖）如实判；G4/G5 需要该
 * 版本的 loopback 报告，导入时不存在 ⇒ 按 I-4「无报告/无套件 = fail」如实判 fail，不默认通过。
 * 判不了（运行环境里没有仓库的实体清单/包源）⇒ 该 skill 不在返回表里，目录如实显示「未评测」。
 */
export interface StarterPackGateJudge {
  judge(input: {
    readonly packId: string;
    readonly skills: readonly {
      readonly stableName: string;
      readonly work: WorkSkillManifest;
      /** `sha256:<hex>`，与 `skill_versions.content_digest` 同口径 */
      readonly versionDigest: string;
    }[];
  }): ReadonlyMap<string, WorkGateStatus>;
}

export const STARTER_PACK_GATE_JUDGE = Symbol("StarterPackGateJudge");

/**
 * 导入成功之后的后续动作：把**因本次导入而变得可发布**的内置 Workflow Definition 发布进本组织。
 *
 * 内置 Definition（problem-to-prd、research-to-insight …）的 Skill 引用只能解析到本组织目录；dev-mode 种子
 * 在任何 starter pack 导入**之前**就跑了发布，于是新环境里绝大多数内置 Workflow 永远停在未发布。导入是
 * 目录里 Skill 出现的唯一入口，所以在导入之后补发布——同一个 UC-WR-1 发布校验，以导入的管理员身份。
 * 失败不影响导入结果（导入已提交；发布可由种子脚本重跑补上）。
 */
export interface StarterPackImportFollowUp {
  afterImport(input: { readonly orgId: OrgId; readonly actorId: string }): Promise<void>;
}

export const STARTER_PACK_IMPORT_FOLLOW_UP = Symbol("StarterPackImportFollowUp");
