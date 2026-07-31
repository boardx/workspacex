/**
 * F74 — 结束后指派说话人：匿名声道↔真人映射记录 + 全量回填可撤销（uc-5-2 R3/R7）。
 *
 * ## 这个文件在防什么
 *
 * uc-5-2 R3 第 3 步说「回填是**指向同一条映射记录的引用，不是复制副本**」（I-10 / I-11），
 * `design-signoff.md` ①/② 两处都把它标成本束最容易出错的一条：只要有任何一个消费方
 * （引述出处 / 洞察来源 / 报告角标 / 图谱节点）把 `personId` 抄了一份到自己的行里，
 * 撤销（AC1「且能撤销」）就再也做不到「一次到位」——你得去改 N 张表，而且大概率漏一张。
 *
 * 所以本文件不提供"把真名写进某处"的任何函数。它只提供一件事：
 * **给定 channelId，此刻应该解析成谁** —— `resolveSpeaker`。
 * 所有消费方（引述渲染、洞察角标、报告来源、图谱节点标签）都调用它，而不是各自存一份
 * `personId`。这样撤销只需要让 `resolveSpeaker` 对同一个 channelId 重新返回 `null`，
 * 全部消费方在下一次读取时自动看到「出处待补」——这是「全量回填可撤销」在数据层的唯一实现方式，
 * 不是"撤销时遍历所有引用并清空它们"（那正是要避免的复制副本模型）。
 *
 * ## 与 F70 的关系（不要在这里改 F70）
 *
 * F70 的 `deriveStatus`（`transcription-core.ts`）已经决定了：重叠段 `speakerChannelId` 恒为
 * `null`（I-7），且它的签名里**没有**任何身份输入（O-14 的匿名化边界）。本文件建在它之上，
 * 但不改它：`speakerChannelId`（匿名声道 id）与 `personId`（真人）之间的映射是**另一张记录**，
 * 不是给 `transcribe()` / `deriveStatus()` 加一个身份参数——那会把 F70 刻意排除的东西
 * 从后门加回去。`resolveSpeaker` 的输入是 F70 产出的 `speakerChannelId`，输出是
 * `resolvedSpeaker`（契约里 `Segment.resolvedSpeaker`，out-only 派生字段，I-10）。
 *
 * ## 本文件不决定的事
 *
 * · **候选人名单的来源**——`deriveCandidates` 只做「roster → candidates」的形状转换，
 *   在场名单本身由应用层的 `RosterProvider` 端口提供（I-9 / I-12：候选 ⊆ 本场在场名单，
 *   不存在跨场次声纹比对）。
 * · **重叠段门禁**（`OVERLAP_SEGMENT_REQUIRES_SPLIT`）——F71 拥有 `pending-manual` 的判定，
 *   本文件的 `assignChannel` 只消费「这个声道当前是否还有未拆分的重叠段」这个既成事实。
 * · **`disputed` 是否正式状态**（`[待定 D-9]`）——不在本文件范围内。
 */
import { recording as C } from "@repo/contracts";
import type { z } from "zod";

export type RecordingErrorCode = z.infer<typeof C.RecordingError>;
export type SpeakerCandidate = z.infer<typeof C.SpeakerCandidate>;

export type DomainResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RecordingErrorCode };

const fail = (reason: RecordingErrorCode): DomainResult<never> => ({ ok: false, reason });

/** 在场名单里的一个人——应用层 `RosterProvider` 的返回形状。 */
export interface RosterEntry {
  readonly personId: string;
  readonly displayName: string;
}

/**
 * roster → candidates。**唯一的转换规则**：`source` 恒为字面量 `"roster"`。
 *
 * 这个函数**没有第二个参数**——没有 `sessionHistory`、没有 `voiceprintIndex`、
 * 没有任何跨场次输入的位置。这不是靠"没调用"来保证 I-9/I-12，而是靠函数签名本身：
 * 想给出一个不在本场在场名单里的候选人，唯一的办法是把它塞进 `roster` 参数——
 * 而 `roster` 的值**只能**来自调用方传入的本场名单。
 */
export function deriveCandidates(roster: readonly RosterEntry[]): readonly SpeakerCandidate[] {
  return roster.map((entry) => ({
    personId: entry.personId,
    displayName: entry.displayName,
    source: "roster" as const,
  }));
}

/**
 * 一条声道↔人映射记录。**这是唯一的事实存放处**——`segments` 表不得有 `personId` 列（I-10），
 * `resolveSpeaker` 只读这张表，不读任何 segment 行上的冗余字段。
 */
export interface AssignmentRecord {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly personId: string;
  /** 乐观并发版本——每次成功指派该声道递增一次（`CHANNEL_VERSION_CHANGED`，E3）。 */
  readonly channelVersion: number;
  readonly assignedAt: string;
  /** `null` = 仍生效。撤销不删记录，写 `revokedAt`——保留审计轨迹（uc-5-2 R7 收口）。 */
  readonly revokedAt: string | null;
}

/**
 * **本文件最重要的函数**：给定 channelId，此刻的说话人是谁。
 *
 * ⚠ 只看"该声道当前未被撤销的那条记录"，**不看历史**——一个声道同一时刻至多一条生效映射
 *   （由 `assignChannel` 的 `CHANNEL_ALREADY_ASSIGNED` 保证）。撤销后这里立即返回 `null`，
 *   这就是全部消费方"回填处同步退回出处待补"的完整实现：它们下次调用这个函数，
 *   而不是读自己缓存的一份 `personId`。
 *
 * 未指派 ⇒ `null`——界面渲染「出处待补」，**不是空字符串，也不是编出来的人名**（I-10 注释原文）。
 */
export function resolveSpeaker(
  channelId: string,
  assignments: readonly AssignmentRecord[],
): string | null {
  const active = assignments.find((a) => a.channelId === channelId && a.revokedAt === null);
  return active?.personId ?? null;
}

/** `assignChannel` 的输入——纯函数版本，DB 读取已经由应用层做完。 */
export interface AssignChannelInput {
  readonly sessionId: string;
  readonly channelId: string;
  readonly personId: string;
  readonly expectedChannelVersion: number;
  /** 该声道当前是否还存在未拆分的重叠段（F71 的既成事实，本函数只消费）。 */
  readonly hasUnresolvedOverlap: boolean;
  /**
   * 该声道**最近一条**映射记录——**无论生效还是已撤销**。乐观并发版本号跟着"这个声道
   * 被写过多少次"走，不跟着"当前是否生效"走：撤销之后重新指派同一声道，版本号必须
   * 从撤销时的值继续往上加，而不是退回 0——否则并发场景下会出现两个不同世代的
   * `expectedChannelVersion: 0` 互相打架。`null` = 这个声道从未被写过。
   */
  readonly latestAssignment: AssignmentRecord | null;
  /** 本场在场名单——`PERSON_NOT_IN_ROSTER` 的判据，**不做任何跨场次回退**（I-9）。 */
  readonly roster: readonly RosterEntry[];
}

export interface AssignChannelDecision {
  readonly personId: string;
  readonly nextChannelVersion: number;
}

/**
 * 校验一次整声道指派**该不该发生**（副作用——写记录、算 `affectedSegmentCount`、
 * 回填计数——留给应用层，因为那需要真实的 segment/quote/insight 存储）。
 *
 * 校验顺序是契约的一部分：重叠门禁 → 版本 → 已指派 → 名单——**版本冲突**判在**已指派**
 * 之前，因为版本不符本身就说明调用方拿的是过期读，"已指派"这个结论对它而言还没资格谈；
 * **已指派**判在**名单**之前，因为「声道已经属于别人」比「你选的人不在名单里」是更根本的
 * 拒绝理由，不该被名单校验抢答。
 */
export function checkAssignChannel(input: AssignChannelInput): DomainResult<AssignChannelDecision> {
  // I-7 / O-13：未拆分的重叠段唯一解除出口是 F71 的拆分动作，这里只能拒绝，不能绕过。
  if (input.hasUnresolvedOverlap) return fail("OVERLAP_SEGMENT_REQUIRES_SPLIT");

  const currentVersion = input.latestAssignment?.channelVersion ?? 0;
  // E3：并发指派/重指派同一声道——版本不符即拒绝，**不静默覆盖**。
  if (currentVersion !== input.expectedChannelVersion) return fail("CHANNEL_VERSION_CHANGED");

  // 版本对得上，但声道此刻仍有一条生效（未撤销）的映射 ⇒ 已经属于别人。
  if (input.latestAssignment !== null && input.latestAssignment.revokedAt === null) {
    return fail("CHANNEL_ALREADY_ASSIGNED");
  }

  // I-9：候选人必须在本场在场名单里，没有任何跨场次来源可以回退。
  if (!input.roster.some((r) => r.personId === input.personId)) {
    return fail("PERSON_NOT_IN_ROSTER");
  }

  return { ok: true, value: { personId: input.personId, nextChannelVersion: currentVersion + 1 } };
}

/** `revokeAssignment` 的输入——同样是纯校验，副作用（真正回填/回退计数）留给应用层。 */
export interface RevokeAssignmentInput {
  readonly assignment: AssignmentRecord | undefined;
}

export function checkRevokeAssignment(input: RevokeAssignmentInput): DomainResult<AssignmentRecord> {
  if (input.assignment === undefined) return fail("ASSIGNMENT_NOT_FOUND");
  if (input.assignment.revokedAt !== null) return fail("ASSIGNMENT_ALREADY_REVOKED");
  return { ok: true, value: input.assignment };
}
