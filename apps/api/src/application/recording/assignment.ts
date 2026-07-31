/**
 * F74 — 说话人指派用例：`listChannelsAndCandidates` / `assignChannel` / `revokeAssignment`。
 *
 * 每个用例都是 `domain/recording/speaker-assignment.ts` 的纯校验 + 这里的端口读写。
 * 副作用只有两类：① 写一条 `AssignmentRecord`（或改它的 `revokedAt`）；
 * ② 读 `BackfillConsumers` 报计数——**从不读写任何消费方的内容**，因为 I-10/I-11
 * 要求回填是引用而不是副本，本用例没有"改引述表""改报告表"这类步骤，
 * 因为压根不存在需要改的第二份数据。
 */
import type { RecordingErrorCode } from "../../domain/recording/speaker-assignment";
import {
  checkAssignChannel,
  checkRevokeAssignment,
  deriveCandidates,
  resolveSpeaker,
  type AssignmentRecord,
  type SpeakerCandidate,
} from "../../domain/recording/speaker-assignment";
import type {
  AssignmentStore,
  BackfillConsumers,
  ChannelInspector,
  IdGenerator,
  RosterProvider,
} from "./assignment-ports";

export type Fail = { readonly ok: false; readonly reason: RecordingErrorCode };
export type Ok<T> = { readonly ok: true } & T;
export type Result<T> = Ok<T> | Fail;

const fail = (reason: RecordingErrorCode): Fail => ({ ok: false, reason });

export interface AssignmentDeps {
  readonly roster: RosterProvider;
  readonly channels: ChannelInspector;
  readonly assignments: AssignmentStore;
  readonly backfill: BackfillConsumers;
  readonly ids: IdGenerator;
}

/**
 * `listChannelsAndCandidates` 的候选人部分 —— 声道列表本身来自 F70/F71 的产出，
 * 不在本 feature 范围内；这里只提供 I-9/I-12 那一半：候选人 ⊆ 本场在场名单。
 */
export async function listSpeakerCandidates(
  deps: AssignmentDeps,
  sessionId: string,
): Promise<Result<{ candidates: readonly SpeakerCandidate[] }>> {
  const roster = await deps.roster.rosterOf(sessionId);
  if (roster === undefined) return fail("ROSTER_UNAVAILABLE");
  return { ok: true, candidates: deriveCandidates(roster) };
}

export interface AssignChannelInput {
  readonly sessionId: string;
  readonly channelId: string;
  readonly personId: string;
  readonly expectedChannelVersion: number;
  readonly assignedAt: string;
}

export interface AssignChannelOutput {
  readonly assignmentId: string;
  readonly affectedSegmentCount: number;
  readonly backfilledRefs: readonly { readonly kind: string; readonly count: number }[];
}

/**
 * `assignChannel` —— 整声道指派，一次覆盖全部段落。
 *
 * ⚠ **不复制**：这里不写"把 personId 写进每个 segment"这一步。写入的只有一条
 *   `AssignmentRecord`；`affectedSegmentCount` 与 `backfilledRefs` 都是**只读计数**，
 *   证明"回填"确实发生（有东西现在能解析出说话人了），而不是执行了一次数据搬运。
 */
export async function assignChannel(
  deps: AssignmentDeps,
  input: AssignChannelInput,
): Promise<Result<AssignChannelOutput>> {
  const roster = await deps.roster.rosterOf(input.sessionId);
  if (roster === undefined) return fail("ROSTER_UNAVAILABLE");

  const [hasUnresolvedOverlap, latestAssignment, affectedSegmentCount] = await Promise.all([
    deps.channels.hasUnresolvedOverlap(input.sessionId, input.channelId),
    deps.assignments.latestFor(input.sessionId, input.channelId),
    deps.channels.segmentCountFor(input.sessionId, input.channelId),
  ]);

  const decision = checkAssignChannel({
    sessionId: input.sessionId,
    channelId: input.channelId,
    personId: input.personId,
    expectedChannelVersion: input.expectedChannelVersion,
    hasUnresolvedOverlap,
    latestAssignment: latestAssignment ?? null,
    roster,
  });
  if (!decision.ok) return fail(decision.reason);

  const assignmentId = deps.ids.next("rec-assignment");
  const record: AssignmentRecord = {
    assignmentId,
    sessionId: input.sessionId,
    channelId: input.channelId,
    personId: decision.value.personId,
    channelVersion: decision.value.nextChannelVersion,
    assignedAt: input.assignedAt,
    revokedAt: null,
  };
  await deps.assignments.create(record);

  // 指派**之后**才去数计数——此刻 `resolveSpeaker` 已经能对这个 channelId 解析出人了,
  // 所以这里数到的就是"从现在起能看见出处"的引用数，而不是指派前的旧计数。
  const counts = await deps.backfill.countsReferencing(input.sessionId, input.channelId);
  const backfilledRefs = Object.entries(counts).map(([kind, count]) => ({ kind, count }));

  return { ok: true, assignmentId, affectedSegmentCount, backfilledRefs };
}

export interface RevokeAssignmentOutput {
  readonly assignmentId: string;
  readonly revokedAt: string;
  readonly revertedRefs: readonly { readonly kind: string; readonly count: number }[];
}

/**
 * `revokeAssignment` —— 撤销后所有回填处**同步退回「出处待补」**（uc-5-2 R3 第 3 步 / AC1）。
 *
 * ⚠ 同样不遍历"所有引用它的地方"去清空它们：撤销只是把这一条 `AssignmentRecord` 的
 *   `revokedAt` 置位。下一次任何消费方调用 `resolveSpeaker(channelId, …)`，
 *   因为这条记录不再是 active 的，会自然拿到 `null`。`revertedRefs` 里的计数只是
 *   "验证一下确实有这么多处会退回"，不是撤销动作本身的一部分。
 */
export async function revokeAssignment(
  deps: AssignmentDeps,
  input: { readonly assignmentId: string; readonly revokedAt: string },
): Promise<Result<RevokeAssignmentOutput>> {
  const existing = await deps.assignments.byId(input.assignmentId);
  const checked = checkRevokeAssignment({ assignment: existing });
  if (!checked.ok) return fail(checked.reason);

  await deps.assignments.revoke(input.assignmentId, input.revokedAt);

  const counts = await deps.backfill.countsReferencing(checked.value.sessionId, checked.value.channelId);
  const revertedRefs = Object.entries(counts).map(([kind, count]) => ({ kind, count }));

  return { ok: true, assignmentId: input.assignmentId, revokedAt: input.revokedAt, revertedRefs };
}

export { resolveSpeaker };
