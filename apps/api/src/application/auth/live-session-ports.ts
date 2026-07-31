/**
 * `LiveSessionRepository` —— F16（UC-1.3 R7）的持久化端口。
 *
 * 三个写方法对应 I-12 / I-13 / I-14 的三种事件，理由与 `invite-link-ports.ts` 的
 * 「撤销为什么带 linkId: null 这个分支而不是两个方法」同型，但这里反过来分成两个方法：
 * `markSurvivesUntilStage`（单条撤销，I-13）与 `markImmediateEnd`（[重置全部]，I-14）
 * **落库的列不同**——前者只写 `revoked_at` + `survives_until_stage_id`，会话仍「在场」；
 * 后者额外写 `ended_at`，会话立即从签到板上消失。合成一个方法要么多一个布尔参数
 * 分叉两套 SQL、要么让两条 UPDATE 共享一条容易在未来漏改的 WHERE。
 */
import type { Guarded } from "../security/permission-filter";
import type { OrgId } from "../../domain/org-id";

/* ─────────────────────────── 到场回写 ─────────────────────────── */

export interface CheckInInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly participantId: string;
  readonly linkId: string;
  readonly guestIdentityId: string;
  readonly groupId: string | null;
  /** 进场时刻的议程环节 id；06-现场协作尚未接入时为 null（domain.md `LiveSession.enteredAtStageId`）。 */
  readonly currentStageId: string | null;
  readonly now: Date;
}

export interface LiveSessionRow {
  readonly sessionId: string;
  readonly participantId: string;
  readonly linkId: string;
  readonly groupId: string | null;
  readonly revokedAt: Date | null;
  readonly survivesUntilStageId: string | null;
  readonly endedAt: Date | null;
}

/* ─────────────────────────── 撤销：两种终局 ─────────────────────────── */

export interface MarkSurvivesUntilStageInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** 刚被撤销的那些链接 id（单条撤销时长度恒为 1）。 */
  readonly linkIds: readonly string[];
  readonly currentStageId: string | null;
  readonly now: Date;
}

export interface MarkSurvivesUntilStageResult {
  /** 受影响（本次被标记「保留至该环节结束」）的在场会话数——即 `out.onsiteSessions`。 */
  readonly affected: number;
  /** `affected === 0` 时为 null（契约：无在场会话需要保留 ⇒ 无环节可言）。 */
  readonly stageId: string | null;
}

export interface MarkImmediateEndInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly now: Date;
}

export interface MarkImmediateEndResult {
  readonly affected: number;
}

export interface LiveSessionRepository {
  /** 到场回写：同一名单条目重复签到（掉线重连）命中同一条在场会话，不产生第二条。 */
  checkIn(input: CheckInInput): Promise<LiveSessionRow>;
  /** I-13：单条撤销 —— 该链接名下仍在场的会话保留至当前环节结束。 */
  markSurvivesUntilStage(input: MarkSurvivesUntilStageInput): Promise<MarkSurvivesUntilStageResult>;
  /** I-14：[重置全部] —— 本项目全部在场会话立即结束。 */
  markImmediateEnd(input: MarkImmediateEndInput): Promise<MarkImmediateEndResult>;
  /** 供 I-13 时序断言：读回单条会话当前落库状态，交给 `liveSessionWriteVerdict` 判定。 */
  get(orgId: OrgId, sessionId: string): Promise<LiveSessionRow | undefined>;
  /** 签到板：按组聚合的在场/总数 + 逐人到场状态。含名单条目的展示层字段 ⇒ `Guarded`。 */
  board(orgId: OrgId, projectId: string): Promise<Guarded<readonly CheckinGroupRow[]>>;
}

export interface CheckinRosterEntryRow {
  readonly alias: string;
  readonly attendance: "present" | "absent";
}

export interface CheckinLinkRow {
  readonly url: string;
  readonly qrPayload: string | null;
}

export interface CheckinGroupRow {
  readonly groupId: string;
  readonly title: string;
  readonly present: number;
  readonly total: number;
  readonly links: readonly CheckinLinkRow[];
  readonly roster: readonly CheckinRosterEntryRow[];
}

export const LIVE_SESSION_REPOSITORY = Symbol("LiveSessionRepository");
