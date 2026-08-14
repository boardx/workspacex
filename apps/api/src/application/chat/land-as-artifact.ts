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

  // 消息定位——也是判权的起点（同 `expandToolCallChain` / `locateCitation` 的既有纪律）。
  const location = await deps.chat.findMessageLocation(orgId, messageId);
  if (location === null || location.threadId !== threadId) {
    throw new ThreadNotVisibleError();
  }

  const outcome = await resolveVisibility(deps, {
    userId, orgId, projectId: location.projectId, threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // 观察者恒无写权——与 `mutateThread` / `updateAgentRoster` 同一条规则。
  const role = outcome.actor.projectRole;
  if (role === null || role === "observer") {
    throw new NoWriteRoleError();
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
        projectId: location.projectId,
        source: "ai-generated",
        title,
        actorId: userId,
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
