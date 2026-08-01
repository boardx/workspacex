/**
 * `checkDownstreamEligibility` —— UC-21：引用资格门（F114 · uc-8-3 R4 / I-34）。
 *
 * ## 为什么这里没有直接调用 phase-00 `artifact.referenceForDownstream`
 *
 * `usecases.md` 逐字写着"这个门必须是 phase-00 `artifact` 的 `referenceForDownstream`
 * 那一个，对话侧不自己判是不是快照"。但 `referenceForDownstream` 的资格判断
 * （`judgeCitation`）读的是 `BindingRepository.findAnchorsForArtifact`——那张表的行
 * 只由 `bindToProjectStep` 写入，而 `land-as-artifact.ts` 文件头已经登记：本 UC
 * 没有调用 `bindToProjectStep`（`landAsArtifact` 的契约输入没有 `agendaSegmentId`）。
 *
 * 于是"同一个门"在字面上不可达——本函数改为对**同一条规则**的等价判断：
 * `isEligibleForDownstream(mode) ⟺ mode === "pinned"`，与 `judgeCitation` 判的是
 * 完全相同的事实（"这个产出是不是被冻结到了一个不可变快照"），只是读的是本束自己
 * 记录的 `mode`，不是 phase-00 的绑定表。**已登记为契约缺口**（`chat.ts` 的
 * `KNOWN_CONTRACT_GAPS.C_CHAT_10`），不是把它当作已经对齐来隐瞒。
 *
 * `purpose` 的四值→五值换算同样标注在那条缺口备注（`C_CHAT_2` 原文）：这里给出
 * 一份显式、可读的映射表，作为该缺口被人类正式裁决前的**临时**换算，而不是假装
 * 缺口已经解决。
 */
import type { OrgId } from "../../domain/org-id";
import { isEligibleForDownstream } from "../../domain/chat/artifact-landing";
import type { ArtifactLandingRepository } from "./artifact-landing-ports";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export type ChatDownstreamPurposeName =
  "report-final" | "submit-acceptance" | "decision-evidence" | "write-back-kg";

/**
 * chat 的四个 purpose → phase-00 `artifact.DownstreamPurpose` 的五个之一。
 * ⚠ **临时换算**，见文件头——`C_CHAT_2` 登记的缺口本身没有解决，这里只是让
 * 四个值各自有一个可读的名字，供审计 `detail` 里记录用途，不参与本函数的判定
 * （判定只看 `mode`，见下）。
 */
export const CHAT_TO_ARTIFACT_PURPOSE: Readonly<Record<ChatDownstreamPurposeName, string>> = {
  "report-final": "report-final",
  "submit-acceptance": "acceptance",
  "decision-evidence": "decision-reference",
  "write-back-kg": "graph-writeback",
};

export class ArtifactLandingNotFoundError extends Error {
  constructor() {
    super("artifact_landing_not_found");
  }
}

/** I-34：非 pinned 一律拒绝，错误指向「需先定版为固定快照」。 */
export class RequiresPinnedError extends Error {
  constructor() {
    super("requires_pinned");
  }
}

export interface CheckDownstreamEligibilityDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly landings: ArtifactLandingRepository;
}

export interface CheckDownstreamEligibilityInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly purpose: ChatDownstreamPurposeName;
}

export interface CheckDownstreamEligibilityResult {
  readonly allowed: true;
  readonly versionId: string;
}

export async function checkDownstreamEligibility(
  deps: CheckDownstreamEligibilityDeps,
  input: CheckDownstreamEligibilityInput,
): Promise<CheckDownstreamEligibilityResult> {
  const { orgId, artifactId } = input;

  const landing = await deps.landings.findByArtifactId(orgId, artifactId);
  if (landing === null) throw new ArtifactLandingNotFoundError();

  // 不可见与不存在同一个出口（I-3）：这条产出所在的线程，调用者必须先能看见。
  // `resolveVisibility` 要求 `projectId`——从线程自己的事实里取，不是调用方传入的
  // （本函数的契约输入只有 `artifactId`/`purpose`，没有 `projectId`）。
  const threadFacts = await deps.chat.findThreadFacts(orgId, landing.threadId);
  if (threadFacts === null) throw new ThreadNotVisibleError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId, projectId: threadFacts.projectId, threadId: landing.threadId,
  });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  if (!isEligibleForDownstream(landing.mode)) {
    throw new RequiresPinnedError();
  }

  // `landing.mode === "pinned"` 时 `versionId` 由 `chat_artifact_landings` 的 CHECK
  // 约束保证非空（见迁移文件）——这里的非空断言只是把数据库已经保证的事实告诉类型系统。
  return { allowed: true, versionId: landing.versionId! };
}
