/**
 * Ports for `[AI 建议人选]`'s candidate state (F98, uc-6-7 R3-3 / AC3).
 *
 * ## Why a candidate needs its own store, not a row in `interview_subjects`
 *
 * AC3 is explicit: a suggestion "默认落候选态...经引导师逐条确认后才进对象表" -- so a
 * suggestion is NOT a subject with a draft flag, it is a different kind of thing that only
 * BECOMES a subject through a human's explicit `acceptCandidate`. Modelling it as a row in
 * `interview_subjects` with a `status: candidate` would mean every reader of that table
 * (the group-card projection, the interview roster projection, UC-6.2's "选对象") has to
 * remember to filter it out, and the day one forgets, an AI suggestion nobody confirmed
 * shows up as if a human added it -- exactly the failure R7's "落候选态...经人确认才入表"
 * exists to prevent.
 *
 * ## In-memory today, same posture as F86's `in-memory-consent-token-repository.ts`
 *
 * A candidate is short-lived scratch state between `suggestCandidates` and
 * `acceptCandidate` -- it does not need to survive a restart the way `interview_subjects`
 * does. This repository is process-local and said so, following the exact precedent that
 * file's own header states: swapping this one file for a Postgres-backed implementation
 * later does not touch either use case.
 */
import type { OrgId } from "../../domain/org-id";

export interface SubjectCandidate {
  readonly candidateId: string;
  readonly orgId: OrgId;
  readonly groupId: string;
  /** `null` = 匿名候选（对齐 `Subject.displayName` 允许匿名代称的既有约定）。 */
  readonly name: string | null;
  readonly roleTitle: string;
  readonly reason: string;
  readonly sources: readonly string[];
  /** 重复人选合并提示（E2）；非空则该候选与某个既有对象是同一人。 */
  readonly duplicateOfSubjectId: string | null;
  readonly suggestedBy: string;
  readonly suggestedAt: string;
}

export interface CandidateStore {
  put(candidate: SubjectCandidate): Promise<void>;
  get(orgId: OrgId, candidateId: string): Promise<SubjectCandidate | null>;
  /** 三出口之二（加入表 / 编辑后加入）与「忽略」都终结这条候选态——候选不是可重复消费的。 */
  remove(orgId: OrgId, candidateId: string): Promise<void>;
}

export const CANDIDATE_STORE = Symbol("CandidateStore");

/**
 * 「AI 依据项目主题与背景、本组场景、组织已有历史访谈对象」建议人选（R3-3）的生成器。
 *
 * ⚠ 本 feature 没有可调用的真实 LLM/agent 基础设施（本仓其它束目前也没有一个可复用的
 * 「访谈 AI」调用点），所以下面的默认实现（见 `in-memory-candidate-store.ts` 同目录的
 * `HistoryBasedCandidateSuggester`）是一个**确定性的启发式**：在同组织内查找与本组
 * 「组织」字段相同的既有对象，理由写明「该人选此前已作为本组织其他场次的访谈对象」。
 * 这不是假装做了 AI 判断——是如实登记「候选生成逻辑当前是启发式，不是模型调用」这条
 * 缺口，同时仍然满足契约形状（机器产出标识 + 理由 + 来源 + 候选态）与 V12
 * （AI 服务不可用时手工加对象仍可用，因为两条路径完全独立）。
 */
export interface CandidateSuggestion {
  readonly name: string | null;
  readonly roleTitle: string;
  readonly reason: string;
  readonly sources: readonly string[];
  readonly duplicateOfSubjectId: string | null;
}

export interface CandidateSuggestionPort {
  suggest(orgId: OrgId, groupId: string): Promise<readonly CandidateSuggestion[]>;
}

export const CANDIDATE_SUGGESTION_PORT = Symbol("CandidateSuggestionPort");
