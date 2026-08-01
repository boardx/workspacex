/**
 * 用例：换工作流模板（F26 / `uc-2-2` R7 步骤 7a / 契约 `switchWorkflowTemplate`）。
 *
 * ## 破坏性变更须先给影响面，再要确认（A5 / V9f）
 *
 * `confirmed: false` ⇒ 只读地算出 `impact`（`computeSwitchTemplateImpact`，纯函数）
 * 并**零写入**返回；`confirmed: true` 才真的替换环节链与矩阵。这与 F19
 * `set-duration-tier.ts` 换档位确认门是同一个形状：先出清单，后写入，不是「写完了
 * 再告诉你丢了什么」。
 *
 * ⚠ 首次为项目选模板（`current === null`）没有旧编排可比较，视同**非破坏性**——
 *   同 `planDurationTierChange` 里「`currentTier: null` 不构成破坏性变更」的同一条理由，
 *   这里体现为 `impact` 恒空、`confirmed` 与否都直接写入。
 *
 * ⚠ `TEMPLATE_SWITCH_FORBIDDEN_AFTER_START` **不在本文件的任何分支被抛出**——
 *   契约注释逐字「为 D-11 裁决预留的码，当前不应触发」，D-11（项目已开始后是否禁止换）
 *   未裁决前，本用例没有判据可以触发它。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { computeSwitchTemplateImpact } from "../../domain/templates/workflow-orchestration";
import type { ProjectRole } from "../../domain/identity/roles";
import { canWriteOrchestration } from "./orchestration-write-guard";
import type {
  OrchestrationRepository,
  WorkflowTemplateCatalogPort,
} from "./workflow-orchestration-ports";

export type SwitchWorkflowTemplateOutput = z.infer<typeof templates.operations.switchWorkflowTemplate.out>;
export type SwitchWorkflowTemplateErrorCode = z.infer<typeof templates.TemplateError>;

/** 一个类携带契约里的一个错误码，同本束既有的 `ApplyBlueprintError` 一类形状。 */
export class SwitchWorkflowTemplateError extends Error {
  readonly reasonCode: SwitchWorkflowTemplateErrorCode;
  constructor(reasonCode: SwitchWorkflowTemplateErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "SwitchWorkflowTemplateError";
  }
}

export interface SwitchWorkflowTemplateInput {
  readonly projectId: string;
  readonly templateId: string;
  readonly confirmed: boolean;
  readonly actorProjectRole: ProjectRole | null;
}

export interface SwitchWorkflowTemplateDeps {
  readonly orchestrations: OrchestrationRepository;
  readonly catalog: WorkflowTemplateCatalogPort;
  /** 实例矩阵格 id 的分配。注入而不是内部生成——同 F63 `newBindingId` 的理由。 */
  readonly newCellId: (index: number) => string;
  /** 新编排快照的修订号。注入而不是内部生成——测试要断言的是内容不是随机串。 */
  readonly newRevision: () => string;
}

export async function switchWorkflowTemplate(
  deps: SwitchWorkflowTemplateDeps,
  input: SwitchWorkflowTemplateInput,
): Promise<SwitchWorkflowTemplateOutput> {
  if (!canWriteOrchestration(input.actorProjectRole)) {
    throw new SwitchWorkflowTemplateError(
      input.actorProjectRole === null ? "NO_PROJECT_ROLE" : "ROLE_INSUFFICIENT",
    );
  }

  const target = await deps.catalog.load(input.templateId);
  if (target === null) throw new SwitchWorkflowTemplateError("DEPENDENCY_UNAVAILABLE");

  const current = await deps.orchestrations.load(input.projectId);

  const impact =
    current === null
      ? { droppedCells: 0, affectedTasks: 0, lostSegments: [] }
      : computeSwitchTemplateImpact(current, target.segments);

  const isDestructive = impact.droppedCells > 0 || impact.lostSegments.length > 0;
  if (isDestructive && !input.confirmed) {
    // ⚠ 零写入：连 `deps.orchestrations.save` 都不调用，不只是「返回码对但已经写了」。
    return {
      impact: {
        droppedCells: impact.droppedCells,
        affectedTasks: impact.affectedTasks,
        lostSegments: impact.lostSegments.map((s) => ({ ...s })),
      },
      applied: false,
    };
  }

  await deps.orchestrations.replace(input.projectId, {
    template: { templateId: target.templateId, name: target.name, sourceVersion: target.sourceVersion },
    segments: target.segments.map((s) => ({ ...s })),
    matrix: target.matrix.map((c, i) => ({ ...c, cellId: deps.newCellId(i) })),
    revision: deps.newRevision(),
  });

  return {
    impact: {
      droppedCells: impact.droppedCells,
      affectedTasks: impact.affectedTasks,
      lostSegments: impact.lostSegments.map((s) => ({ ...s })),
    },
    applied: true,
  };
}
