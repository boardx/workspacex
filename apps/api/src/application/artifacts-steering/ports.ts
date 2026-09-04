/**
 * 契约束 `artifacts-steering` 的应用层端口 —— Phase 14 F09（Artifact 领域模型 + 版本化 API）。
 *
 * 只覆盖 F09 本身：UC-1 `getArtifact` / UC-2 `listArtifactVersions` / UC-3
 * `continueArtifact`，以及"工具调用产出文件 ⇒ 创建/追加 Artifact 版本"这条写入路径
 * （`requirements/04-artifacts-steering.md#R3` 步骤 1/5）。`interject`（UC-4）是 F11，
 * 不在这里。前端消费点（F10/F12）也不在这里。
 *
 * 领域模型见 `phases/phase-14-agent-kernel-unification/contracts/artifacts-steering/domain.md`
 * （I-1～I-4）；API 契约见 `packages/contracts/src/artifacts-steering.ts`（唯一事实源，
 * 这里的类型直接复用它，不重复定义）。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** Ids only —— 够用来问可见性问题，不够用来回答它（同 `agent-run/ports.ts` 的 `RunLocator`）。 */
export interface ArtifactLocator {
  readonly threadId: string;
  readonly projectId: string;
}

/** 创建 Artifact 首个版本所需的输入（R3 步骤 1：工具调用产出文件 ⇒ 建 Artifact，而非聊天附件）。 */
export interface CreateArtifactInput {
  readonly id: string;
  readonly threadId: string;
  readonly name: string;
  readonly kind: AS.ArtifactKind;
  readonly producedByRunId: string;
  readonly producedByStepId: string;
  readonly changeNote: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
}

/** 追加一个新版本所需的输入（R3 步骤 5：`continueArtifact` 触发的 run 成功后）。 */
export interface AppendArtifactVersionInput {
  readonly artifactId: string;
  readonly producedByRunId: string;
  readonly producedByStepId: string;
  readonly changeNote: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
}

/**
 * `ArtifactStore` —— Artifact 聚合的持久化端口。
 *
 * I-2（版本不可变）在这里是**接口形状本身**的约束：没有任何方法接受 `version` 参数去
 * 覆写已存在版本的 `storageKey`——`appendVersion` 只会在版本历史末尾追加下一个版本号，
 * 具体实现（`PgArtifactStore`）额外有数据库层面的 append-only 触发器兜底。
 */
export interface ArtifactStore {
  /** 首次创建 Artifact（version=1）。`id` 由调用方生成（见 `ArtifactClock.newArtifactId`）。 */
  createArtifact(orgId: OrgId, input: CreateArtifactInput): Promise<AS.ArtifactRecord>;

  /**
   * 在已有 Artifact 上追加下一个版本（`version` = 当前最大版本号 + 1，服务端计算，
   * 不接受调用方传入版本号——防止并发追加时两次 continue 撞到同一个版本号）。
   */
  appendVersion(orgId: OrgId, input: AppendArtifactVersionInput): Promise<AS.ArtifactVersionInfo>;

  /**
   * `Guarded<T>`，不是裸 `ArtifactRecord`（UC-0.3 R7 / coherence X-1）：这条读把 Artifact
   * 内容交到调用方手上，必须经 `discloseDecided()` 配一个真实的 `PermissionDecision`
   * 才能拆出来——同 `AgentRunStore.readRun` 的既有先例（`pg-agent-run-repository.ts`）。
   */
  getArtifact(orgId: OrgId, artifactId: string): Promise<Guarded<AS.ArtifactRecord> | null>;

  listVersions(
    orgId: OrgId,
    input: AS.ListArtifactVersionsInput,
  ): Promise<Guarded<AS.ListArtifactVersionsOutput>>;

  /** I-4：显式按版本号查找，找不到返回 `null`（调用方据此判 `ARTIFACT_VERSION_NOT_FOUND`）。 */
  findVersion(orgId: OrgId, artifactId: string, version: number): Promise<Guarded<AS.ArtifactVersionInfo> | null>;

  /** 够用来问可见性问题的最小定位信息；`null` = Artifact 不存在。 */
  findLocator(orgId: OrgId, artifactId: string): Promise<ArtifactLocator | null>;
}

export const ARTIFACT_STORE = Symbol("ArtifactStore");

/**
 * `continueArtifact` 触发新 run 的端口（UC-3 的 `out.runId`）。
 *
 * ⚠ 本 feature（F09）**只定义这个端口，不提供生产实现**——"新 run 具体怎么发起"
 * 横跨 `chat`（`acceptHumanMessage`）与本束，design-signoff 第③点已把这条边界标注为
 * "是否需要在两束之间加一条交叉说明，请确认"，尚未拍板到可以安全接线的程度。
 * `continueArtifact` 本身（含 I-4 的版本解析）已经完整实现并由 `artifact-versioning`/
 * `artifact-continue-version-context` 两条 verification 用例覆盖；接一个真实
 * `ArtifactRunLauncher` 是后续 feature（很可能是 F10 或 F11 落地时）的范围。
 */
export interface ArtifactRunLauncher {
  /**
   * @param basedOnVersion I-4：调用方已经按 `basedOnVersion` 显式查到的那个版本
   *   （不是"当前最新版本"）——本端口的实现不得自己重新决定用哪个版本。
   */
  launch(
    orgId: OrgId,
    input: {
      readonly userId: string;
      readonly threadId: string;
      readonly artifactId: string;
      readonly instruction: string;
      readonly basedOnVersion: AS.ArtifactVersionInfo;
    },
  ): Promise<{ readonly runId: string }>;
}

export const ARTIFACT_RUN_LAUNCHER = Symbol("ArtifactRunLauncher");

export interface ArtifactClock {
  now(): string;
  newArtifactId(): string;
}
