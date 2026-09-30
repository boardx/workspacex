/**
 * 共享线 Workflow 定义（批次 2：W003 / W004 / W007，见 `BATCH2_WORKFLOW_SLOTS` 中 line = "shared"）。
 *
 * 目录已接入白名单 / 可发起端口（`workflow-allowlist.ts` 的 CONTENT_WORKFLOW_CATALOGS）与授权清单
 * （`buildCapabilityCatalog` 默认目录）。新增时：`line` 必须为 "shared"、`key` 取自 `BATCH2_WORKFLOW_SLOTS`；
 * W017 不得出现（见 PHASE_WORKFLOW_IDS / DEFERRED_WORKFLOW_IDS）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";
import { W003 } from "./w003";
import { W004 } from "./w004";
import { W007 } from "./w007";

export { W003, W004, W007 };

export const SHARED_WORKFLOW_DEFINITIONS: readonly WorkContentWorkflowModule[] = Object.freeze([W003, W004, W007]);
