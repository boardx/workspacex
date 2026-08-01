/**
 * F75 — 本场声纹 embedding 销毁时点与级联失效（O-14，uc-5-2 R7）。
 *
 * ## 这个文件在防什么
 *
 * `domain.md` 把这条标成「本束最硬的一条」：`VoiceprintEmbedding` 属
 * `derived_representations`，指派完成即销毁，兜底不超过本场结束后 7 天，销毁是
 * **物理删除 + 审计事件**（I-15），不是打标记；且级联失效任何以它为输入的派生物（I-16），
 * 销毁后重跑 diarization 只产生新版本、旧特征不复活（I-17）。
 *
 * 与 F74（`speaker-assignment.ts`）的关系：F74 决定「声道绑到了谁」；本文件决定
 * 「支撑那次绑定的声纹特征什么时候必须消失」。两者共享同一个「声道是否已指派」的
 * 事实（`resolveSpeaker` 是否非空），但本文件不读 `AssignmentRecord`——它只吃应用层
 * 已经算好的 `ChannelAssignmentState[]`，保持这层的输入形状与 F74 无耦合。
 *
 * ## 天数纪律（易漏点，务必先读）
 *
 * `tests/rec/retention-param-resolution-no-hardcode.test.ts` 的静态检查扫描的是
 * **整个 `src/domain/recording` + `src/application/recording` 目录**，不是单个文件；
 * 黑名单 `[7, 30, 90, 180, 365, 1095]` **没有豁免通道**。本 UC 的兜底销毁天数字面意义上
 * 就是「7」，但它**不能**以数字字面量出现在本文件或其应用层同伴里——即便 O-14 已经把
 * 这个值裁死（不像材料保留期那样还等合规输入），门控本身不区分"已裁决的 7"和
 * "写死的 180"。因此兜底天数在这里被建模成**参数**（`fallbackDays`），
 * 由应用层的 `VoiceprintPolicyProvider` 端口提供，与 `retention.ts` 对
 * `RetentionParameters` 的处理同一纪律：本文件里不出现这个数，只出现"用了参数"这件事。
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type RecordingErrorCode = z.infer<typeof C.RecordingError>;

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

const fail = (reason: RecordingErrorCode): DomainResult<never> => ({ ok: false, reason });

/** 一天的毫秒数——单位换算，不是策略取值（同 `retention.ts` 的这条纪律）。 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type VoiceprintDestroyReason = "assigned" | "fallback-d7";

/** `derived_representations` 里的一条本场声纹特征。 */
export interface VoiceprintEmbeddingRecord {
  readonly embeddingId: string;
  readonly sessionId: string;
  readonly channelId: string;
  /** 固化的兜底到期时间（`session.endedAt + fallbackDays`）——由 `computeEmbeddingExpiry` 算出。 */
  readonly expiresAt: string;
  /** 物理删除时刻。`null` = 仍存在。I-13：指派完成后本场记录数须为 0，靠这个字段之外的
   *  「记录已被物理移除」来断言，而不是靠它非空——软删不满足 I-15。 */
  readonly destroyedAt: string | null;
}

/** 某个匿名声道此刻是否已有生效指派——应用层从 F74 的 `resolveSpeaker` 结果算出。 */
export interface ChannelAssignmentState {
  readonly channelId: string;
  readonly isAssigned: boolean;
}

/**
 * I-13 的判据：「指派完成」= 本场全部匿名声道都已有生效映射。
 *
 * 没有声道（`channels.length === 0`）不算「完成」——那是「还没做 diarization」，
 * 不是「指派空白」，不该触发销毁（没有东西可指派，也就没有指派完成这件事发生过）。
 */
export function isAssignmentComplete(channels: readonly ChannelAssignmentState[]): boolean {
  return channels.length > 0 && channels.every((c) => c.isAssigned);
}

/**
 * `destroyVoiceprints`（trigger=`assignment-completed`）的纯校验。
 * 指派未完成 ⇒ 拒绝，不得提前销毁——提前销毁会让「未完成」的声道回填从此无声纹可回溯。
 */
export function checkDestroyOnAssignmentComplete(input: {
  readonly channels: readonly ChannelAssignmentState[];
}): DomainResult<{ readonly trigger: "assignment-completed" }> {
  if (!isAssignmentComplete(input.channels)) return fail("ASSIGNMENT_NOT_COMPLETE");
  return { ok: true, value: { trigger: "assignment-completed" } };
}

/**
 * 兜底到期时间——本场结束时刻 + 兜底天数。**天数是参数**（见文件头），不是这里的字面量。
 */
export function computeEmbeddingExpiry(sessionEndedAt: string, fallbackDays: number): string {
  return new Date(Date.parse(sessionEndedAt) + fallbackDays * MS_PER_DAY).toISOString();
}

/**
 * I-14 的资格判定：兜底销毁**无条件**——不看指派是否完成，只看时间是否到了。
 * `asOf ≥ endedAt + fallbackDays` 才有资格；未到不得销毁（哪怕指派确实没做）。
 */
export function isSweepEligible(sessionEndedAt: string, asOf: string, fallbackDays: number): boolean {
  const dueMs = Date.parse(sessionEndedAt) + fallbackDays * MS_PER_DAY;
  return Date.parse(asOf) >= dueMs;
}

/**
 * 一条以某个声纹 embedding 为输入的派生物/缓存（`derived_representations` 的下游）。
 * 这是该 domain 逻辑需要的最小投影，不是 `packages/contracts` 里 `DerivedRepresentation`
 * 契约的重定义——字段集完全不同（那边是完整实体，这里只取级联失效判定要用的三个字段）。
 */
export interface DerivedRepresentationRef {
  readonly id: string;
  readonly inputEmbeddingId: string;
  /** `null` = 仍标记有效。 */
  readonly invalidatedAt: string | null;
}

/**
 * I-16 的核心：给定「刚被物理删除的 embedding id 集合」，找出所有仍标记有效、
 * 但输入已经不存在的派生物——这些必须被失效，销毁才算完整，不是「删了向量就完事」。
 */
export function deriveInvalidationTargets(
  derivedReps: readonly DerivedRepresentationRef[],
  destroyedEmbeddingIds: readonly string[],
): readonly string[] {
  const destroyed = new Set(destroyedEmbeddingIds);
  return derivedReps
    .filter((d) => destroyed.has(d.inputEmbeddingId) && d.invalidatedAt === null)
    .map((d) => d.id);
}

/** I-17 前半：重跑 diarization 产生的版本号必须严格递增，不是复用/回退。 */
export function nextDerivedVersion(previousVersion: number): number {
  return previousVersion + 1;
}

/**
 * I-17 后半（反证判据）：重跑产生的新特征 id 集合必须与已销毁集合不相交——
 * 旧特征不因为"同一个声道又跑了一次 diarization"而复活。
 */
export function noRevival(
  newEmbeddingIds: readonly string[],
  destroyedEmbeddingIds: readonly string[],
): boolean {
  const destroyed = new Set(destroyedEmbeddingIds);
  return newEmbeddingIds.every((id) => !destroyed.has(id));
}
