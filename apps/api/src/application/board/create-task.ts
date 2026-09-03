/**
 * F02 -- manual task creation (uc-11-1 R3.5): "人建的卡不经 inbox，与 UC-11.2 的 AI 建卡
 * 路径相反，必填负责人与标题，来源徽标记为手工创建。"
 */
import { randomUUID } from "node:crypto";
import { isTaskStatus, type TaskStatus } from "../../domain/board/task-status";
import { MANUAL_SOURCE_KIND } from "../../domain/board/source-kind";
import { assertHumanOwner } from "../../domain/board/owner-identity";
import { isRiskLevel, type RiskLevel } from "../../domain/board/risk-level";
import type { TaskRepository } from "./ports";
import type { DatabasePort } from "../ports/database.port";
import type { OrgId } from "../../domain/org-id";

export type CreateTaskRejectReason =
  | "TITLE_REQUIRED"
  | "OWNER_REQUIRED"
  | "OWNER_MUST_BE_HUMAN"
  | "MANUAL_CREATE_CANNOT_TARGET_INBOX"
  | "UNKNOWN_STATUS"
  | "UNKNOWN_RISK_LEVEL";

export class CreateTaskRejectedError extends Error {
  constructor(readonly code: CreateTaskRejectReason) {
    super(code);
  }
}

export interface CreateTaskDeps {
  readonly db: DatabasePort;
  readonly tasks: TaskRepository;
}

export interface CreateTaskInput {
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly title: string;
  readonly ownerUserId: string;
  readonly executor?: string | null;
  readonly dueAt?: string | null;
  readonly riskLevel?: string | null;
  readonly waitingOn?: string | null;
  /** Defaults to `todo` -- manual cards skip `inbox` (R3.5), and there is no reason to
   *  default further along than the first working column. */
  readonly status?: string;
}

export interface CreateTaskOutput {
  readonly id: string;
  readonly status: TaskStatus;
  readonly sourceKind: typeof MANUAL_SOURCE_KIND;
}

export async function createTask(deps: CreateTaskDeps, input: CreateTaskInput): Promise<CreateTaskOutput> {
  const title = input.title.trim();
  if (title === "") throw new CreateTaskRejectedError("TITLE_REQUIRED");

  const ownerUserId = input.ownerUserId.trim();
  if (ownerUserId === "") throw new CreateTaskRejectedError("OWNER_REQUIRED");
  try {
    assertHumanOwner(ownerUserId);
  } catch {
    throw new CreateTaskRejectedError("OWNER_MUST_BE_HUMAN");
  }

  const status = input.status ?? "todo";
  if (!isTaskStatus(status)) throw new CreateTaskRejectedError("UNKNOWN_STATUS");
  // R3.5: "人建的卡不经 inbox" -- not merely a default, a rejection of an explicit request too.
  if (status === "inbox") throw new CreateTaskRejectedError("MANUAL_CREATE_CANNOT_TARGET_INBOX");

  let riskLevel: RiskLevel | null = null;
  if (input.riskLevel !== undefined && input.riskLevel !== null && input.riskLevel !== "") {
    if (!isRiskLevel(input.riskLevel)) throw new CreateTaskRejectedError("UNKNOWN_RISK_LEVEL");
    riskLevel = input.riskLevel;
  }

  const id = randomUUID();
  await deps.db.withTenant(input.orgId, (session) =>
    deps.tasks.createWithin(session, {
      id,
      orgId: input.orgId,
      projectId: input.projectId,
      title,
      status,
      sourceKind: MANUAL_SOURCE_KIND,
      ownerUserId,
      executor: input.executor?.trim() || null,
      dueAt: input.dueAt ?? null,
      riskLevel,
      waitingOn: input.waitingOn?.trim() || null,
    }));

  return { id, status, sourceKind: MANUAL_SOURCE_KIND };
}
