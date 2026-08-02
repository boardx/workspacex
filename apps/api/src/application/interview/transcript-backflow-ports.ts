/**
 * Ports for F99's transcript-backflow slice (uc-6-7 R3 步骤 8).
 */
import type { OrgId } from "../../domain/org-id";
import type { ConsentBits } from "../../domain/interview/subject";

/** 对象归组的最小事实。`groupId === null` = 未归组（A1，回流目标缺失）。 */
export interface SubjectGroupFacts {
  readonly subjectId: string;
  readonly groupId: string | null;
}

export interface SubjectGroupLookup {
  /** `null` = 该对象不存在（与 `SubjectRepository.findGuardedById` 同一「不存在/无权不可区分」不适用于此——
   *  这是系统内部路由，不是对外可探测的读接口，所以直接如实返回未找到）。 */
  find(orgId: OrgId, subjectId: string): Promise<SubjectGroupFacts | null>;
}

export const SUBJECT_GROUP_LOOKUP = Symbol("SubjectGroupLookup");

/**
 * 同意位的系统内部读取。
 *
 * ⚠ 复用 `ConsentSubmissionStore` 同一张事实表（不重开一份同意书状态），但这里
 * 不经 `Guarded`/`disclose`——回流管线是转写落地后自动触发的系统动作，不是
 * 某个用户在读某一行数据；唯一对外泄露的信息是 `quotesOnly` 这一位布尔值，
 * 而契约本就要求 `routeTranscriptToGroup` 把它算出来交给调用方（AC8）。
 * 与 `booking-ports.ts` 的 `SubjectBookingContextProvider` 同一处置手法。
 */
export interface ConsentBitsForRouting {
  latestBits(orgId: OrgId, interviewId: string, subjectId: string): Promise<ConsentBits | null>;
}

export const CONSENT_BITS_FOR_ROUTING = Symbol("ConsentBitsForRouting");

/** 一条已落盘的引用：产出物 id + **固定快照**版本 id（D-30/D-38，不是 live/draft 引用）。 */
export interface TranscriptArtifactRef {
  readonly artifactId: string;
  readonly versionId: string;
}

/**
 * 该场访谈中,某对象名下已生成、已定版的转写/引述/洞察产出引用。
 *
 * ⚠ 本端口的实现方负责保证只返回**已定版**（pinned）的快照引用——「正式引用绑定
 * 固定快照」（D-30/D-38）是 F66/F07 那条不变量,本端口不重复它的判定逻辑,
 * 只声明它的输出必须满足这个前提。
 */
export interface TranscriptArtifactSource {
  refsFor(orgId: OrgId, interviewId: string, subjectId: string): Promise<readonly TranscriptArtifactRef[]>;
}

export const TRANSCRIPT_ARTIFACT_SOURCE = Symbol("TranscriptArtifactSource");
