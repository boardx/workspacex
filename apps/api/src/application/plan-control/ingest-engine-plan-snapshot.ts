/**
 * UC-2 `ingestEnginePlanSnapshot` —— 引擎快照落账本（内部端口，无 HTTP 面）。
 *
 * 权威规格：`usecases.md` UC-2 + `domain.md` I-6/I-9。由 `write_todos` 成功时的既有生产者
 * 调用（`copilotkit-agui.controller.ts` 里 `STATE_SNAPSHOT` 那个判定点），本文件不新建
 * 第二条触发路径——它只是那个判定点该调的函数。
 *
 * ⚠ 永远被接受（I-6）：这个 use case 没有 `PlanControlError` 出参，写入失败直接向上抛。
 * ⚠ `origin='engine'` 的新行 `constraints` 恒为空数组（I-9）——这里无条件产出空数组，
 * 不尝试从上一版「继承」约束；约束的生命周期完全在 F974 的 UC-5/UC-6（用户编辑）范围内。
 */
import { randomUUID } from "node:crypto";
import type { PlanStep, PlanStepStatus } from "@repo/contracts/plan-control";
import type { OrgId } from "../../domain/org-id";
import type { PlanLedgerRepository } from "./ports";

export interface IngestEnginePlanSnapshotInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  /** `AguiPlanTodo[]`（`agui-state-events.ts`）—— payload 没有 id，见 I-3 的警告。 */
  readonly todos: ReadonlyArray<{ readonly content: string; readonly status: PlanStepStatus }>;
}

export interface IngestEnginePlanSnapshotOutput {
  readonly revision: number;
  readonly engineEpoch: number;
}

/**
 * I-6 的 planStepId 继承启发式：新快照第 i 条，若 `content` 与上一版某一条**逐字相等**
 * 则继承其 `planStepId`，否则新发一个。一条旧 step 只被消费一次（先到先得），避免同一个
 * `planStepId` 被两条新内容相同的新步骤同时认领。
 *
 * ⚠ 这是一个刻意的、已知会出错的启发式（人类 2026-08-26 签核时明确接受，见
 * `design-signoff.md` ② 节）——引擎侧 payload 没有 id，这是唯一能做的事。
 */
export function assignStepIds(
  newTodos: ReadonlyArray<{ readonly content: string; readonly status: PlanStepStatus }>,
  previousSteps: readonly PlanStep[],
): PlanStep[] {
  const pool = [...previousSteps];
  return newTodos.map((todo) => {
    const matchIndex = pool.findIndex((prev) => prev.content === todo.content);
    let planStepId: string;
    if (matchIndex >= 0) {
      planStepId = pool[matchIndex]!.planStepId;
      pool.splice(matchIndex, 1);
    } else {
      planStepId = randomUUID();
    }
    return { planStepId, content: todo.content, status: todo.status, constraints: [] };
  });
}

export async function ingestEnginePlanSnapshot(
  repo: PlanLedgerRepository,
  input: IngestEnginePlanSnapshotInput,
): Promise<IngestEnginePlanSnapshotOutput> {
  const latest = await repo.getLatest(input.orgId, input.threadId);
  const steps = assignStepIds(input.todos, latest?.steps ?? []);
  return repo.appendEngineSnapshot({ orgId: input.orgId, threadId: input.threadId, steps });
}
