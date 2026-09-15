/**
 * `landAsArtifact` —— UC-20：把一条结论 / 产物卡落地为 Artifact（F114 · uc-8-3 R3）。
 *
 * ## 机制委托到什么程度（D-38）
 *
 * 字节与版本血缘（对象存储 write-once + `artifact_versions` 一行 + SHA-256）**全部**
 * 复用 phase-00 `artifact` 的 `materializeArtifact`（F04）——本文件不写一个字节，
 * 也不算一次哈希。source 恒为 `"ai-generated"`（`content.md` = `payloadRef` 原样落盘，
 * `provenance.json` = 出处回链三项，与 `MATERIALIZATION_PLAN["ai-generated"]` 的既有
 * 两文件计划完全对齐，不新增第三个文件）。
 *
 * 三模式（draft/live/pinned）的**合法性判断**——I-33「非 draft 必须有引用」、
 * V4d「pinned 必须 100% 可定位」——在 `domain/chat/artifact-landing.ts` 一处；
 * 本文件只负责把判断结果落到 `chat_artifact_landings` 一行。
 *
 * ⚠ **已登记的契约缺口**（`packages/contracts/src/chat.ts` 的
 * `KNOWN_CONTRACT_GAPS.C_CHAT_10`）：没有走 phase-00 `bindToProjectStep`——那个函数
 * 要求一个真实的 `agendaSegmentId`（把产出提交到项目议程的某一环节），而
 * `landAsArtifact` 的契约输入没有这个字段，落一条草稿也不应该被
 * `bindToProjectStep` 内部的 `group.submitOutput` 项目角色门槛挡住
 * （那会让"组员"这个本 UC 的 Actor 之一连给自己存草稿都不行）。本文件因此只调用
 * `materializeArtifact` 拿真实版本，模式与来源判定是本束自己的一张表。
 */
import { chat as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import {
  decideLanding,
  type LandingModeName,
} from "../../domain/chat/artifact-landing";
import type { ArtifactRepository, IdFactory, ObjectStore } from "../artifact/ports";
import { materializeArtifact } from "../artifact/materialize-artifact";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ArtifactLandingRepository } from "./artifact-landing-ports";
import { LANDED_CONTENT_EXCERPT_MAX_CHARS } from "../agent-run/file-retrieval";
import type { ChatCitationRow, ChatRepository } from "./ports";
import { isCitationLocatable } from "./locate-citation";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export type CitationOut = z.infer<typeof C.Citation>;

export class NoWriteRoleError extends Error {
  constructor() {
    super("no_write_role");
  }
}

/** I-33：非 draft 模式下引用清单为空——只能显式改用 draft 重新提交。 */
export class MissingProvenanceBacklinkError extends Error {
  constructor() {
    super("missing_provenance_backlink");
  }
}

/** V4d：pinned 模式下存在不可定位的引用——只能显式改用 draft 重新提交。 */
export class CitationUnresolvableRequiresDraftError extends Error {
  constructor() {
    super("citation_unresolvable_requires_draft");
  }
}

/**
 * 个人线程落地硬锁 draft（人类裁决，2026-08-21）——`live`/`pinned` 会打开项目专属的
 * 下游流转语义（`isEligibleForDownstream`），个人线程没有这个维度。与
 * `NoWriteRoleError` 分开报（那是"没有写权限"，这是"有写权限，但这个 mode 不适用
 * 这条线程"，混成一个错误码会让客户端没法分辨该不该提示"换个模式重试"）。
 */
export class PersonalThreadRequiresDraftError extends Error {
  constructor() {
    super("personal_thread_requires_draft");
  }
}

export class MaterializationFailedError extends Error {}

export interface LandAsArtifactDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly artifacts: ArtifactRepository;
  readonly store: ObjectStore;
  /**
   * ⚠ 命名为 `artifactIds`，不是 `ids`——`ResolveVisibilityDeps`（经 `AuthorizeDeps`）
   * 已经声明了一个 `ids: DecisionIdFactory`（`next(): string`，无参数），与这里需要的
   * `IdFactory`（`next(prefix: string): string`）签名不同。同名重声明会让接口互相
   * 不兼容——`mutate-thread.ts` 的 `artifactIds` 是同一个理由的既有先例，这里照抄命名。
   */
  readonly artifactIds: IdFactory;
  readonly landings: ArtifactLandingRepository;
  readonly provenance: ProvenanceWriter;
}

export interface LandAsArtifactInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly messageId: string;
  readonly mode: LandingModeName;
  readonly title: string;
  readonly payloadRef: string;
  /**
   * 追加到**这个已有 Artifact** 的下一个版本（契约 `landAsArtifact.in.artifactId`）。
   *
   * `undefined` = 今天的行为，逐字不变：`materializeArtifact` 自己 `ids.next("art")`
   * 建新 artifact，版本号 1。给了值则走 `materializeArtifact` 早就支持的
   * 「adding a version to an EXISTING artifact」分支（版本号 = head + 1，服务端算）。
   *
   * ⚠ **不是**随便哪个 artifact 都行：必须已经在**本线程**落地过（下面那道
   * `findLatestByThreadAndArtifact` 门）。否则这个字段就成了「往组织内任意
   * artifact 追加一个版本」的口子——落地路径的判权只判线程，判不了别束的 artifact。
   */
  readonly artifactId?: string;
}

export interface LandAsArtifactResult {
  readonly artifactId: string;
  readonly versionId: string | null;
  readonly contentHash: string | null;
  readonly mode: LandingModeName;
  readonly hasSource: boolean;
  readonly provenanceBacklink: {
    readonly conversationId: string;
    readonly messageId: string;
    readonly citations: readonly CitationOut[];
  };
}

function toCitationOut(row: ChatCitationRow): CitationOut {
  return {
    citationId: row.citationId,
    index: row.index,
    sourceFullName: row.sourceFullName,
    anchor: {
      kind: row.anchorKind,
      page: row.anchorPage,
      range: row.anchorRange,
      messageId: row.anchorMessageId,
    },
  };
}

export async function landAsArtifact(
  deps: LandAsArtifactDeps,
  input: LandAsArtifactInput,
): Promise<LandAsArtifactResult> {
  const { userId, orgId, threadId, messageId, mode, title, payloadRef } = input;
  const targetArtifactId = input.artifactId;

  // 消息定位——也是判权的起点（同 `expandToolCallChain` / `locateCitation` 的既有纪律）。
  const location = await deps.chat.findMessageLocation(orgId, messageId);
  if (location === null || location.threadId !== threadId) {
    throw new ThreadNotVisibleError();
  }

  const outcome = await resolveVisibility(deps, {
    userId, orgId, projectId: location.projectId, threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // 个人线程（人类裁决，2026-08-21，issue #728 round 16 P10 留的开放问题在此落地）：
  // `outcome.actor.projectRole` 恒为 null（个人线程没有项目角色这个维度，见
  // `resolve-visibility.ts` 的 `resolvePersonalVisibility`），但能走到这一行说明
  // `resolveVisibility` 已经验证过 `actorUserId === thread.createdBy`
  // （`decidePersonalThreadRead` 的 `projectLayerAllowed`）——即个人线程分支的
  // 「role === null」不是「无权限」，是「这个维度不适用，权限已经在上一步判过了」。
  // 项目线程分支不能沿用这条豁免：那里的 `role === null` 是真的「没有项目角色」。
  const isPersonalThread = outcome.thread.projectId === null;
  if (!isPersonalThread) {
    // 观察者恒无写权——与 `mutateThread` / `updateAgentRoster` 同一条规则。
    const role = outcome.actor.projectRole;
    if (role === null || role === "observer") {
      throw new NoWriteRoleError();
    }
  } else if (mode !== "draft") {
    // 个人线程落地硬锁 draft（同 `summarizePersonaFromThread` 既有判例
    // `packages/contracts/src/chat.ts` 的 `C_CHAT_11`）——`live`/`pinned` 会经
    // `isEligibleForDownstream` 打开 report-final/submit-acceptance 等下游流转，
    // 那是项目专属语义，个人线程的产出不适用。前端目前所有入口本来就只发
    // draft（画布保存/落地按钮/画像生成三处皆是），这里加一道后端硬校验，
    // 不依赖「前端恰好没传别的 mode」这个隐性约定。
    throw new PersonalThreadRequiresDraftError();
  }

  // 追加版本的**归属门**：只能追加到本线程已经落地过的 artifact 上。
  // 与「不可见/不存在」同一个出口（I-3）——不区分「这个 id 不存在」和「这个 id 存在
  // 但不属于本线程」，否则这个字段就是一台 artifact 存在性探测器。
  if (targetArtifactId !== undefined) {
    const prior = await deps.landings.findLatestByThreadAndArtifact(orgId, threadId, targetArtifactId);
    if (prior === null) throw new ThreadNotVisibleError();
    // I-36 的同一条规则：他人的草稿对本人不存在，自然也不能被本人续版本。
    if (prior.mode === "draft" && prior.createdBy !== userId) throw new ThreadNotVisibleError();
  }

  const citations = await deps.chat.findCitationsForMessage(orgId, messageId);
  const locatableFlags = await Promise.all(
    citations.map((c) => isCitationLocatable(deps.chat, orgId, c)),
  );
  const allCitationsLocatable = locatableFlags.every((v) => v);

  const verdict = decideLanding({
    requestedMode: mode,
    citationCount: citations.length,
    allCitationsLocatable,
  });
  if (verdict.kind === "missing-provenance-backlink") throw new MissingProvenanceBacklinkError();
  if (verdict.kind === "citation-unresolvable-requires-draft") {
    throw new CitationUnresolvableRequiresDraftError();
  }

  const provenanceJson = JSON.stringify({
    conversationId: threadId,
    messageId,
    citations: citations.map(toCitationOut),
  });

  let materialized;
  try {
    materialized = await materializeArtifact(
      { store: deps.store, repo: deps.artifacts, ids: deps.artifactIds },
      {
        orgId,
        // 省略时（`undefined`）`materializeArtifact` 走 `ids.next("art")` 新建分支——
        // 与本字段存在之前逐字相同。
        artifactId: targetArtifactId,
        // 追加版本时 `materializeArtifact` 不会再写 artifacts 行，这两个字段只在
        // 新建分支有意义；仍原样传，保持与既有调用一致。
        projectId: location.projectId,
        source: "ai-generated",
        title,
        actorId: userId,
        ...(targetArtifactId === undefined
          ? {}
          : // F44 既有的「有人往已有 artifact 上加版本」语义，逐字复用，不新起枚举。
            { versionCreatorKind: "user" as const, versionChangeSource: "materialize" as const }),
        parts: {
          "content.md": new TextEncoder().encode(payloadRef),
          "provenance.json": new TextEncoder().encode(provenanceJson),
        },
      },
    );
  } catch (e) {
    throw new MaterializationFailedError(e instanceof Error ? e.message : String(e));
  }

  const landingId = deps.artifactIds.next("land");
  await deps.landings.create({
    id: landingId,
    orgId,
    threadId,
    messageId,
    artifactId: materialized.artifactId,
    versionId: verdict.mode === "pinned" ? materialized.versionId : null,
    title,
    mode: verdict.mode,
    hasSource: verdict.hasSource,
    citationCount: citations.length,
    // F155 L3（delta §4）：落地即可检索。`payloadRef` 就是刚写进 `content.md` 的那份正文
    // （含用户在画布里编辑过的 mermaid 源），这里取它的有界前缀喂给 `search_tsv` 生成列。
    // **未落地**（用户没点保存）的图因此天然不在索引里——那正是 verification V3 要的边界，
    // 不需要任何额外判断逻辑。
    contentExcerpt: payloadRef.slice(0, LANDED_CONTENT_EXCERPT_MAX_CHARS),
    createdBy: userId,
  });

  await deps.provenance.append({
    orgId,
    type: "generated",
    actorId: userId,
    target: { kind: "artifact", id: materialized.artifactId },
    detail: { threadId, messageId, mode: verdict.mode, hasSource: verdict.hasSource },
  });

  return {
    artifactId: materialized.artifactId,
    versionId: verdict.mode === "pinned" ? materialized.versionId : null,
    contentHash: verdict.mode === "pinned" ? materialized.contentHash : null,
    mode: verdict.mode,
    hasSource: verdict.hasSource,
    provenanceBacklink: {
      conversationId: threadId,
      messageId,
      citations: citations.map(toCitationOut),
    },
  };
}
