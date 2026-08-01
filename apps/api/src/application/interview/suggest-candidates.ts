/**
 * `suggestCandidates` —— `[AI 建议人选]`（F98，uc-6-7 R3-3 / AC3）。
 *
 * ## 落候选态，不直接写对象表
 *
 * 每条建议都先经 `CandidateStore.put` 落成候选，再把 `candidateId` 还给调用方——
 * 组卡上还没有多出一行「对象」，只是多了一张待确认的候选卡。真正写入
 * `interview_subjects` 的唯一路径是 `acceptCandidate`（人确认后）。
 *
 * ## 结果里没有联系方式，且不是"忘了填"
 *
 * 契约的 `suggestCandidates.out` 本身就没有 `contact`/`contactMask` 字段——AI 不知道
 * 也不该知道任何人的手机号/邮箱，`CandidateSuggestion`（`candidate-ports.ts`）这个类型
 * 同样没有这个字段。这不是运行时才判断"要不要带上"，是从建议生成的那一刻起，
 * 联系方式就没有出现在任何数据结构里可以被带上。
 */
import { interview } from "@repo/contracts";
import type { z } from "zod";
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { CandidateStore, CandidateSuggestionPort } from "./candidate-ports";
import { AiGenerationUnavailableError } from "./errors";

export type SuggestCandidatesResult = z.infer<typeof interview.operations.suggestCandidates.out>;
export type SuggestCandidatesInputDto = z.infer<typeof interview.operations.suggestCandidates.in>;

export interface SuggestCandidatesDeps {
  readonly suggestions: CandidateSuggestionPort;
  readonly store: CandidateStore;
}

export interface SuggestCandidatesCommand {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly input: SuggestCandidatesInputDto;
}

export async function suggestCandidates(
  deps: SuggestCandidatesDeps,
  cmd: SuggestCandidatesCommand,
): Promise<SuggestCandidatesResult> {
  let raw;
  try {
    raw = await deps.suggestions.suggest(cmd.orgId, cmd.input.groupId);
  } catch {
    // ⚠ V12：AI 服务不可用只落在本端口，`createSubject`（手工加对象）完全不受影响——
    // 两条路径没有共享的失败面。
    throw new AiGenerationUnavailableError();
  }

  const now = new Date().toISOString();
  const candidates: SuggestCandidatesResult["candidates"] = [];
  for (const r of raw) {
    const candidateId = `cand-${randomUUID()}`;
    await deps.store.put({
      candidateId,
      orgId: cmd.orgId,
      groupId: cmd.input.groupId,
      name: r.name,
      roleTitle: r.roleTitle,
      reason: r.reason,
      sources: r.sources,
      duplicateOfSubjectId: r.duplicateOfSubjectId,
      suggestedBy: cmd.actorId,
      suggestedAt: now,
    });
    candidates.push({
      candidateId,
      name: r.name,
      roleTitle: r.roleTitle,
      reason: r.reason,
      sources: [...r.sources],
      origin: "ai" as const,
      duplicateOfSubjectId: r.duplicateOfSubjectId,
    });
  }
  return { candidates };
}
