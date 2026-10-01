/**
 * 内置 Workflow Definition 的发布（dev-mode 种子 / 新环境 bring-up 用）。
 *
 * 图本体在代码注册表里（ADR-118 第 2 条），Definition 版本只是元数据；domain「WorkflowDefinition：官方包可跨
 * 组织导入」。本用例把代码里自带的 Definition（演示 + 产品线 W0xx）逐个导入一个组织：
 *   ensureDefinition（`workflow_definitions` 行）→ UC-WR-1 `publishDefinitionVersion`（同一套发布校验：
 *   管理员、图已注册、阶段 ↔ 节点、Skill 引用可解析）。
 * 逐个独立判定（与 CT05 content-workflow-registration E2 同一立场）：某个 Definition 的 Skill 引用在本组织目录里
 * 解析不到 → 记为 unavailable 并附缺失的 Skill，不影响其它；绝不绕过校验直接写版本行。已发布且内容相同 → 幂等。
 */
import type { WorkflowDefinitionVersionInput } from "@repo/contracts/workflow-runtime";
import { publishDefinitionVersion, type PublishDefinitionDeps } from "./publish-definition-version";
import { WorkflowUseCaseError } from "./workflow-errors";
import type { WorkflowActor, WorkflowDefinitionCatalogPort } from "./workflow-ports";

export interface PublishBuiltInDeps extends PublishDefinitionDeps {
  catalog: Pick<WorkflowDefinitionCatalogPort, "ensureDefinition">;
}

export type BuiltInPublishOutcome =
  | { key: string; version: number; outcome: "published" }
  | { key: string; version: number; outcome: "unavailable"; code: "definition_invalid"; missingSkills: string[] };

export async function publishBuiltInWorkflowDefinitions(
  deps: PublishBuiltInDeps,
  cmd: { orgId: string; actor: WorkflowActor; definitions: readonly WorkflowDefinitionVersionInput[] },
): Promise<BuiltInPublishOutcome[]> {
  const out: BuiltInPublishOutcome[] = [];
  for (const def of cmd.definitions) {
    await deps.catalog.ensureDefinition(cmd.orgId, def.key);
    try {
      await publishDefinitionVersion(deps, { orgId: cmd.orgId, actor: cmd.actor, pathKey: def.key, body: structuredClone(def) });
      out.push({ key: def.key, version: def.version, outcome: "published" });
    } catch (e) {
      if (!(e instanceof WorkflowUseCaseError) || e.code !== "definition_invalid") throw e;
      out.push({ key: def.key, version: def.version, outcome: "unavailable", code: e.code, missingSkills: e.details.missingSkills ?? [] });
    }
  }
  return out;
}
