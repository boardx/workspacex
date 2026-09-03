/**
 * F02 -- 卡片渲染字段组装（uc-11-1 R3.2/R7/R12 V7）。
 *
 * "负责人恒为人、执行者双字段分列显示、不混在一个字段里" -- this is the ONE place a raw
 * task row becomes the shape a view (REST response or, eventually, a UI) reads. Keeping
 * it a separate pure function (rather than inlining the split at the query site) means
 * `owner-is-human-executor-split.test.ts` can assert the invariant without a database.
 */
import { assertHumanOwner } from "./owner-identity";
import { isAgentIdentifier } from "./owner-identity";
import type { TaskStatus } from "./task-status";
import type { SourceKind } from "./source-kind";
import type { RiskLevel } from "./risk-level";

export interface RawTaskRow {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly sourceKind: SourceKind;
  readonly ownerUserId: string | null;
  readonly executor: string | null;
  readonly dueAt: string | null;
  readonly riskLevel: RiskLevel | null;
  readonly waitingOn: string | null;
  readonly syncStatus: "synced" | "out_of_sync";
  readonly projectId: string | null;
  readonly updatedAt: string;
}

export type ExecutorRef =
  | { readonly kind: "human"; readonly id: string }
  | { readonly kind: "agent"; readonly id: string };

export interface RenderedCard {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly sourceKind: SourceKind;
  /** 恒为人的用户 ID，或 null（负责人未指派）。绝不是 agent 标识（见下方断言）。 */
  readonly ownerUserId: string | null;
  /** 可为空 / 人 / agent -- 与 owner 分列，永不合并进同一个字段。 */
  readonly executor: ExecutorRef | null;
  readonly dueAt: string | null;
  readonly riskLevel: RiskLevel | null;
  readonly waitingOn: string | null;
  readonly syncStatus: "synced" | "out_of_sync";
  readonly projectId: string | null;
  readonly updatedAt: string;
}

/**
 * Raised when a stored row somehow has an agent identity in `ownerUserId` -- the DB CHECK
 * constraint and `assertHumanOwner` at write time are supposed to make this unreachable,
 * but the read side re-asserts it rather than silently rendering a broken card, per
 * uc-11-1 R7 "agent 不能被记为负责人" being a hard invariant, not a write-time-only rule.
 */
export class OwnerRenderedAsAgentError extends Error {
  readonly code = "OWNER_RENDERED_AS_AGENT";
  constructor(readonly taskId: string, readonly ownerUserId: string) {
    super("OWNER_RENDERED_AS_AGENT");
  }
}

export function renderCard(row: RawTaskRow): RenderedCard {
  if (row.ownerUserId !== null) {
    try {
      assertHumanOwner(row.ownerUserId);
    } catch {
      throw new OwnerRenderedAsAgentError(row.id, row.ownerUserId);
    }
  }

  const executor: ExecutorRef | null =
    row.executor === null
      ? null
      : { kind: isAgentIdentifier(row.executor) ? "agent" : "human", id: row.executor };

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    sourceKind: row.sourceKind,
    ownerUserId: row.ownerUserId,
    executor,
    dueAt: row.dueAt,
    riskLevel: row.riskLevel,
    waitingOn: row.waitingOn,
    syncStatus: row.syncStatus,
    projectId: row.projectId,
    updatedAt: row.updatedAt,
  };
}
