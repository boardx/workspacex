/**
 * 用例：算本场偏离（F29 / `uc-2-3` R3 步骤 1 / 契约 `templates.computeDeviations`）。
 *
 * 洋葱：application → domain，仓储端口见 `compute-deviations-ports.ts`。
 *
 * ## 谁能看
 *
 * `uc-2-3` R5 把「发起」记在引导师名下（「引导师：可发起、查看并管理本 use case」），
 * 而这张偏离清单正是「提交回蓝本」这条主流程的第一步——查看它与发起提交是同一个人
 * 在同一条流程里的连续两步，不是两件各自独立的权限。⇒ 与 `submitBlueprintChangeRequest`
 * 共用同一条门槛（`canSubmitChangeRequest`，见 `submit-blueprint-change-request.ts`），
 * 不另开一条判断——同 `apply-blueprint.ts` 头注「两处判的是同一条边，写两份判断只会让
 * 『谁能做』在某一天只改对一处」的同一条纪律。
 *
 * ## `NO_DEVIATIONS`：真实空态，不强行凑条目（A3）
 *
 * 偏离清单为空时抛出 `NO_DEVIATIONS`——这不是"出错"，是契约把"这场完全照蓝本跑"
 * 这件事编码成一个显式的、可断言的信号，而不是一个看起来和"有偏离但没查到"
 * 无法区分的空数组。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { computeDeviations } from "../../domain/templates/deviation-diff";
import { canSubmitChangeRequest } from "./submit-blueprint-change-request";
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { ComputeDeviationsRepository } from "./compute-deviations-ports";

export type ComputeDeviationsOutput = z.infer<typeof templates.operations.computeDeviations.out>;
export type ComputeDeviationsErrorCode = z.infer<typeof templates.TemplateError>;

export class ComputeDeviationsError extends Error {
  readonly reasonCode: ComputeDeviationsErrorCode;
  constructor(reasonCode: ComputeDeviationsErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "ComputeDeviationsError";
  }
}

export interface ComputeDeviationsInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface ComputeDeviationsDeps {
  readonly repo: ComputeDeviationsRepository;
}

export async function computeDeviationsUseCase(
  deps: ComputeDeviationsDeps,
  input: ComputeDeviationsInput,
): Promise<ComputeDeviationsOutput> {
  if (input.actorProjectRole === null) throw new ComputeDeviationsError("NO_PROJECT_ROLE");
  if (!canSubmitChangeRequest(input.actorProjectRole)) {
    throw new ComputeDeviationsError("ROLE_INSUFFICIENT");
  }

  const binding = await deps.repo.findProjectBinding(input.orgId, input.projectId);
  if (binding === null) throw new ComputeDeviationsError("DEPENDENCY_UNAVAILABLE");

  const currentContent = await deps.repo.findCurrentProjectContent(input.orgId, input.projectId);
  const deviations = computeDeviations(binding.baseContent, currentContent);

  if (deviations.length === 0) throw new ComputeDeviationsError("NO_DEVIATIONS");

  return { deviations, baseVersionId: binding.baseVersionId };
}
