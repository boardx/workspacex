/**
 * 运营线 Workflow 定义（批次 2：W052 / W053 / W055 / W056，见 `BATCH2_WORKFLOW_SLOTS` 中 line = "operations"）。
 *
 * 目录已接入白名单 / 可发起端口（`workflow-allowlist.ts` 的 CONTENT_WORKFLOW_CATALOGS）与授权清单
 * （`buildCapabilityCatalog` 默认目录）。新增时：`line` 必须为 "operations"、`key` 取自 `BATCH2_WORKFLOW_SLOTS`；
 * W017 不得出现（见 PHASE_WORKFLOW_IDS / DEFERRED_WORKFLOW_IDS）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { W052 } from "./w052";
import { W053 } from "./w053";
import { W055 } from "./w055";
import { W056 } from "./w056";

export { W052, W053, W055, W056 };

export const OPERATIONS_WORKFLOW_DEFINITIONS: readonly WorkContentWorkflowModule[] = Object.freeze([W052, W053, W055, W056]);
