/**
 * 用例：提交回蓝本（F29 / `uc-2-3` R3 步骤 2-3 / 契约 `templates.submitBlueprintChangeRequest`）。
 *
 * 洋葱：application → domain，仓储端口见 `submit-change-request-ports.ts`。
 *
 * ## 提交 ≠ 生效（I-10 / V3），本用例的全部份量在这一句
 *
 * 本用例只调用 `deps.repo.create(...)` 一次，端口签名（见 `submit-change-request-ports.ts`）
 * 没有任何入参能触及蓝本表——不是"应用层选择不改"，是根本没有可以用来改的入口。
 * `pendingNotice` 必须显式告知"已提交，等待 <维护者> 审阅"（A1），不得让引导师
 * 误以为提交等于生效——所以 `out` 是这句话而不是一个看起来像成功的 `{ ok: true }`。
 *
 * ## 谁能提交
 *
 * `uc-2-3` R1 / R5：Actor 是「引导师」，方法负责人只在**合并**这一侧参与
 * （见 `merge-pending-change.ts`）。`canSubmitChangeRequest` 因此只认 `facilitator`——
 * 与 `canApplyBlueprint` 只认 `lead` 同一处置：判断权限的地方只有一个，
 * `computeDeviationsUseCase` 复用同一个函数而不是各自维护一份。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import {
  assertRationalesPresent,
  buildPendingChangeRequests,
  RationaleRequiredError,
  type ChangeRequestSelection,
} from "../../domain/templates/pending-change";
import type { Deviation } from "../../domain/templates/deviation-diff";
import type { ProjectRole } from "../../domain/identity/roles";
import type { SubmitChangeRequestRepository } from "./submit-change-request-ports";

export type SubmitChangeRequestOutput = z.infer<
  typeof templates.operations.submitBlueprintChangeRequest.out
>;
export type SubmitChangeRequestErrorCode = z.infer<typeof templates.TemplateError>;

export class SubmitChangeRequestError extends Error {
  readonly reasonCode: SubmitChangeRequestErrorCode;
  constructor(reasonCode: SubmitChangeRequestErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "SubmitChangeRequestError";
  }
}

/** **只有 `facilitator`**（引导师）——见文件头「谁能提交」。 */
export function canSubmitChangeRequest(projectRole: ProjectRole | null): boolean {
  return projectRole === "facilitator";
}

export interface SubmitChangeRequestInput {
  readonly actorProjectRole: ProjectRole | null;
  readonly actorId: string;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly baseVersionId: string;
  /** 本场当前的全量偏离清单，通常直接来自同一次 `computeDeviationsUseCase` 的结果 */
  readonly deviations: readonly Deviation[];
  readonly selections: readonly ChangeRequestSelection[];
  /** 用于拼 `pendingNotice` 的维护者称呼，默认「蓝本维护者」（R7 用语） */
  readonly maintainerLabel?: string;
}

export interface SubmitChangeRequestDeps {
  readonly repo: SubmitChangeRequestRepository;
  readonly ids: { next(): string };
  readonly clock: { now(): string };
}

export async function submitBlueprintChangeRequestUseCase(
  deps: SubmitChangeRequestDeps,
  input: SubmitChangeRequestInput,
): Promise<SubmitChangeRequestOutput> {
  if (input.actorProjectRole === null) throw new SubmitChangeRequestError("NO_PROJECT_ROLE");
  if (!canSubmitChangeRequest(input.actorProjectRole)) {
    throw new SubmitChangeRequestError("ROLE_INSUFFICIENT");
  }

  try {
    assertRationalesPresent(input.selections);
  } catch (err) {
    if (err instanceof RationaleRequiredError) throw new SubmitChangeRequestError("RATIONALE_REQUIRED");
    throw err;
  }

  const records = buildPendingChangeRequests({
    blueprintId: input.blueprintId,
    baseVersionId: input.baseVersionId,
    sourceProjectId: input.projectId,
    proposedBy: input.actorId,
    proposedAt: deps.clock.now(),
    selections: input.selections,
    deviations: input.deviations,
    idFactory: () => deps.ids.next(),
  });

  const created = await deps.repo.create(records);

  return {
    changeRequestIds: created.map((r) => r.changeRequestId),
    pendingNotice: `已提交，等待${input.maintainerLabel ?? "蓝本维护者"}审阅`,
  };
}
