/**
 * @generated 由 packages/contracts 生成，**请勿手改**。
 *
 * 改这里的值不会改变契约，只会让 mock 与契约漂移——
 * 而「同一事实声明在两处必然漂移」是本项目已经踩过五次的坑（ADR-020）。
 * 要改请改 packages/contracts/src/*.ts，然后跑 pnpm --filter @repo/contracts gen:mock。
 *
 * 门控：node .harness/scripts/lint-contract-source.mjs
 */

import type { z } from "zod";
import * as artifact from "@repo/contracts/artifact";

/** saveDraft 的成功响应样例（由契约生成） */
export const saveDraftMock: z.infer<typeof artifact.operations.saveDraft.out> = {
  "artifactId": "artifactId-1",
  "autosavedAt": "autosavedAt-1",
  "materializedKeys": [
    "materializedKeys-1"
  ]
};

/** saveDraft 的失败模式全集——界面的异常态必须逐个覆盖 */
export const saveDraftErrors = ["MATERIALIZATION_FAILED","DEPENDENCY_UNAVAILABLE"] as const;

/** pinVersion 的成功响应样例（由契约生成） */
export const pinVersionMock: z.infer<typeof artifact.operations.pinVersion.out> = {
  "versionId": "versionId-1",
  "versionNumber": 1,
  "contentHash": "contentHash-1",
  "objectStorageKey": "objectStorageKey-1"
};

/** pinVersion 的失败模式全集——界面的异常态必须逐个覆盖 */
export const pinVersionErrors = ["PROJECT_ROLE_INSUFFICIENT","VERSION_CHANGED","MATERIALIZATION_FAILED","DEPENDENCY_UNAVAILABLE"] as const;

/** bindToProjectStep 的成功响应样例（由契约生成） */
export const bindToProjectStepMock: z.infer<typeof artifact.operations.bindToProjectStep.out> = {
  "id": "id-1",
  "artifactId": "artifactId-1",
  "projectId": "projectId-1",
  "stepId": "stepId-1",
  "mode": "draft",
  "pinnedVersionId": null
};

/** bindToProjectStep 的失败模式全集——界面的异常态必须逐个覆盖 */
export const bindToProjectStepErrors = ["NO_PROJECT_ROLE","PROJECT_ROLE_INSUFFICIENT","STEP_CLOSED","STEP_REJECTS_ARTIFACT_TYPE","ARTIFACT_NOT_FOUND","DEPENDENCY_UNAVAILABLE"] as const;

/** upgradeBinding 的成功响应样例（由契约生成） */
export const upgradeBindingMock: z.infer<typeof artifact.operations.upgradeBinding.out> = {
  "id": "id-1",
  "artifactId": "artifactId-1",
  "projectId": "projectId-1",
  "stepId": "stepId-1",
  "mode": "draft",
  "pinnedVersionId": null
};

/** upgradeBinding 的失败模式全集——界面的异常态必须逐个覆盖 */
export const upgradeBindingErrors = ["CANNOT_DOWNGRADE","VERSION_CHANGED","PROJECT_ROLE_INSUFFICIENT","ARTIFACT_NOT_FOUND"] as const;

/** listBackflow 的成功响应样例（由契约生成） */
export const listBackflowMock: z.infer<typeof artifact.operations.listBackflow.out> = [
  {
    "bindingId": "bindingId-1",
    "artifactId": "artifactId-1",
    "title": "title-1",
    "mode": "draft",
    "version": 1,
    "pinnedBy": "pinnedBy-1",
    "pinnedAt": "pinnedAt-1",
    "badge": "draft"
  }
];

/** listBackflow 的失败模式全集——界面的异常态必须逐个覆盖 */
export const listBackflowErrors = ["NO_PROJECT_ROLE"] as const;

/** referenceForDownstream 的成功响应样例（由契约生成） */
export const referenceForDownstreamMock: z.infer<typeof artifact.operations.referenceForDownstream.out> = {
  "referenceId": "referenceId-1",
  "eligible": false
};

/** referenceForDownstream 的失败模式全集——界面的异常态必须逐个覆盖 */
export const referenceForDownstreamErrors = ["REQUIRES_PINNED","SNAPSHOT_IMMUTABLE","ARTIFACT_NOT_FOUND"] as const;

/** getIngestionStatus 的成功响应样例（由契约生成） */
export const getIngestionStatusMock: z.infer<typeof artifact.operations.getIngestionStatus.out> = {
  "id": "id-1",
  "artifactId": "artifactId-1",
  "status": "RECEIVED",
  "idempotencyKey": "idempotencyKey-1",
  "pipelineVersion": "pipelineVersion-1",
  "note": null
};

/** getIngestionStatus 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getIngestionStatusErrors = ["ARTIFACT_NOT_FOUND","INGESTION_FAILED"] as const;

/** markEvidenceWithdrawn 的成功响应样例（由契约生成） */
export const markEvidenceWithdrawnMock: z.infer<typeof artifact.operations.markEvidenceWithdrawn.out> = {
  "annotatedReferences": [
    "annotatedReferences-1"
  ],
  "notifiedApprovers": [
    "notifiedApprovers-1"
  ],
  "provenanceEventId": "provenanceEventId-1"
};

/** markEvidenceWithdrawn 的失败模式全集——界面的异常态必须逐个覆盖 */
export const markEvidenceWithdrawnErrors = ["ARTIFACT_NOT_FOUND","DEPENDENCY_UNAVAILABLE"] as const;
