/**
 * 共享线 Workflow 定义（批次 2：W003 / W004 / W007，见 `BATCH2_WORKFLOW_SLOTS` 中 line = "shared"）。
 *
 * 平台脚手架：目录已接入白名单 / 可发起端口（`workflow-allowlist.ts` 的 CONTENT_WORKFLOW_CATALOGS），
 * 但**尚无 Definition**——它们依赖的 Skill 包（work-executive / work-customer-success / work-operations）就绪、
 * 且每个固定 Skill 版本通过 G0–G2 后，由「注册 Workflow」步骤在此新增 `wNNN.ts` 并加入下面的数组。
 * 新增时：`line` 必须为 "shared"、`key` 取自 `BATCH2_WORKFLOW_SLOTS`；W017 不得出现（见 PHASE_WORKFLOW_IDS）。
 */
import type { WorkContentWorkflowModule } from "../../workflow-definition-module";

export const SHARED_WORKFLOW_DEFINITIONS: readonly WorkContentWorkflowModule[] = Object.freeze([]);
