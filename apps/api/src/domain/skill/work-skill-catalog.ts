/**
 * Phase 20 WS03 —— Work Skill 目录行的通道/后继变更规则（契约束 `work-skill-meta` I-8 / I-9 / I-10，R7，E3/E4）。
 *
 * 纯函数：给定目录行当前状态 + 请求 + 本组织后继图，判定是否允许以及结果状态。
 * 转移表单源 = 契约 `WORK_SKILL_CHANNEL_TRANSITIONS`（不在此处复述）。
 */
import {
  WORK_SKILL_CHANNEL_TRANSITIONS,
  type WorkSkillChannel,
} from "@repo/contracts/work-skill-meta";

export interface CatalogEntryState {
  readonly skillId: string;
  readonly channel: WorkSkillChannel;
  readonly successorSkillId: string | null;
}

export interface CatalogEntryChange {
  readonly expectedChannel: WorkSkillChannel;
  readonly channel?: WorkSkillChannel;
  /** undefined = 不改；null = 清除 */
  readonly successorSkillId?: string | null;
  /** 仅作审计备注；verified 的判据是门状态记录（EV05），不是本字段。 */
  readonly gateEvidenceRef?: string;
}

export type CatalogChangeDecision =
  | { readonly kind: "ok"; readonly next: CatalogEntryState }
  | { readonly kind: "transition-invalid"; readonly allowed: readonly WorkSkillChannel[]; readonly reason: string }
  | { readonly kind: "successor-invalid"; readonly reason: string }
  | { readonly kind: "g5-not-passed"; readonly reasonCode: string | null; readonly reason: string };

/**
 * EV05（04-eval-gates R3.8，契约束 work-eval UC-7 / I-8）：当前版本的门状态记录中的 G5 判定。
 * `null` = 当前版本没有门状态记录（未评测）。取代 WS03 临时的 `gateEvidenceRef`。
 */
export interface CurrentVersionG5 {
  readonly outcome: "pass" | "fail" | "not_applicable";
  readonly reasonCode: string;
}

/**
 * @param successorOf 本组织所有目录行 skillId → successorSkillId（用于成环检测与存在性判断：不在表内 = 不存在）
 */
export function decideCatalogEntryChange(
  current: CatalogEntryState,
  change: CatalogEntryChange,
  successorOf: ReadonlyMap<string, string | null>,
  currentG5: CurrentVersionG5 | null = null,
): CatalogChangeDecision {
  const allowed = WORK_SKILL_CHANNEL_TRANSITIONS[current.channel];
  if (change.expectedChannel !== current.channel) {
    return { kind: "transition-invalid", allowed, reason: `current channel is ${current.channel}, not ${change.expectedChannel}` };
  }
  let channel = current.channel;
  if (change.channel !== undefined && change.channel !== current.channel) {
    if (!allowed.includes(change.channel)) {
      return { kind: "transition-invalid", allowed, reason: `${current.channel} -> ${change.channel} is not allowed` };
    }
    if (change.channel === "verified" && currentG5?.outcome !== "pass") {
      // ADR-119 #4 / I-8：candidate→verified 以当前版本门状态记录为准，G5 未过（含未评测）→ 409。
      return {
        kind: "g5-not-passed",
        reasonCode: currentG5?.reasonCode ?? null,
        reason: currentG5 ? `G5 for the current version is ${currentG5.outcome} (${currentG5.reasonCode})` : "current version has no gate status record (not evaluated)",
      };
    }
    channel = change.channel;
  }

  let successorSkillId = current.successorSkillId;
  if (change.successorSkillId !== undefined) {
    const target = change.successorSkillId;
    if (target !== null) {
      if (target === current.skillId) return { kind: "successor-invalid", reason: "successor cannot be the skill itself" };
      if (!successorOf.has(target)) return { kind: "successor-invalid", reason: "successor skill does not exist" };
      const seen = new Set<string>([current.skillId]);
      let cursor: string | null | undefined = target;
      while (cursor) {
        if (seen.has(cursor)) return { kind: "successor-invalid", reason: "successor chain forms a cycle" };
        seen.add(cursor);
        cursor = successorOf.get(cursor);
      }
    }
    successorSkillId = target;
  }
  return { kind: "ok", next: { skillId: current.skillId, channel, successorSkillId } };
}
