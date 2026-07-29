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
import * as contextPack from "@repo/contracts/context-pack";

/** assembleContextPack 的成功响应样例（由契约生成） */
export const assembleContextPackMock: z.infer<typeof contextPack.operations.assembleContextPack.out> = {
  "packId": "packId-1",
  "runId": "runId-1",
  "query": {
    "tenantId": "tenantId-1",
    "principalId": "principalId-1",
    "projectIds": [
      "projectIds-1"
    ],
    "task": "search",
    "query": "query-1",
    "timeRange": null,
    "allowedSensitivity": [
      "allowedSensitivity-1"
    ],
    "tokenBudget": 1,
    "freshnessRequirement": null,
    "evidencePolicy": "primary-only"
  },
  "retrievalPlan": [
    {
      "channel": "fts",
      "weight": 1,
      "hitCount": 1
    }
  ],
  "items": [
    {
      "segmentId": "segmentId-1",
      "content": "content-1",
      "sourceType": "file",
      "artifactVersionId": "artifactVersionId-1",
      "anchor": {
        "page": 1,
        "bbox": [
          1
        ],
        "startMs": 1,
        "endMs": 1,
        "messageId": "messageId-1",
        "surveyQuestionId": "surveyQuestionId-1",
        "imageRegion": {
          "x": 1,
          "y": 1,
          "w": 1,
          "h": 1
        }
      },
      "retrievalReasons": [
        "recall"
      ],
      "channels": [
        "fts"
      ],
      "score": 1,
      "permissionDecisionId": "permissionDecisionId-1"
    }
  ],
  "claims": [
    {
      "statement": "statement-1",
      "status": "proposed",
      "supportingSegmentIds": [
        "supportingSegmentIds-1"
      ],
      "contradictingSegmentIds": [
        "contradictingSegmentIds-1"
      ]
    }
  ],
  "omissions": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ],
  "tokensUsed": 1,
  "pinnedSnapshotId": null
};

/** assembleContextPack 的失败模式全集——界面的异常态必须逐个覆盖 */
export const assembleContextPackErrors = ["RETRIEVAL_UNAVAILABLE","BUDGET_EXCEEDS_MANUAL","PERMISSION_REVOKED_MIDWAY","CONFIDENTIAL_REQUIRES_LOCAL_MODEL"] as const;

/** replayContextPack 的成功响应样例（由契约生成） */
export const replayContextPackMock: z.infer<typeof contextPack.operations.replayContextPack.out> = {
  "packId": "packId-1",
  "runId": "runId-1",
  "query": {
    "tenantId": "tenantId-1",
    "principalId": "principalId-1",
    "projectIds": [
      "projectIds-1"
    ],
    "task": "search",
    "query": "query-1",
    "timeRange": null,
    "allowedSensitivity": [
      "allowedSensitivity-1"
    ],
    "tokenBudget": 1,
    "freshnessRequirement": null,
    "evidencePolicy": "primary-only"
  },
  "retrievalPlan": [
    {
      "channel": "fts",
      "weight": 1,
      "hitCount": 1
    }
  ],
  "items": [
    {
      "segmentId": "segmentId-1",
      "content": "content-1",
      "sourceType": "file",
      "artifactVersionId": "artifactVersionId-1",
      "anchor": {
        "page": 1,
        "bbox": [
          1
        ],
        "startMs": 1,
        "endMs": 1,
        "messageId": "messageId-1",
        "surveyQuestionId": "surveyQuestionId-1",
        "imageRegion": {
          "x": 1,
          "y": 1,
          "w": 1,
          "h": 1
        }
      },
      "retrievalReasons": [
        "recall"
      ],
      "channels": [
        "fts"
      ],
      "score": 1,
      "permissionDecisionId": "permissionDecisionId-1"
    }
  ],
  "claims": [
    {
      "statement": "statement-1",
      "status": "proposed",
      "supportingSegmentIds": [
        "supportingSegmentIds-1"
      ],
      "contradictingSegmentIds": [
        "contradictingSegmentIds-1"
      ]
    }
  ],
  "omissions": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ],
  "tokensUsed": 1,
  "pinnedSnapshotId": null
};

/** replayContextPack 的失败模式全集——界面的异常态必须逐个覆盖 */
export const replayContextPackErrors = ["RUN_NOT_FOUND"] as const;

/** listOmissions 的成功响应样例（由契约生成） */
export const listOmissionsMock: z.infer<typeof contextPack.operations.listOmissions.out> = {
  "omissions": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ],
  "droppedCount": 1,
  "thresholdUsed": 1,
  "complianceAlwaysShown": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ]
};

/** listOmissions 的失败模式全集——界面的异常态必须逐个覆盖 */
export const listOmissionsErrors = ["RUN_NOT_FOUND"] as const;

/** gateAiCall 的成功响应样例（由契约生成） */
export const gateAiCallMock: z.infer<typeof contextPack.operations.gateAiCall.out> = {
  "allowed": false,
  "blockReason": null
};

/** gateAiCall 的失败模式全集——界面的异常态必须逐个覆盖 */
export const gateAiCallErrors = ["RUN_NOT_FOUND"] as const;

/** verifyCitation 的成功响应样例（由契约生成） */
export const verifyCitationMock: z.infer<typeof contextPack.operations.verifyCitation.out> = {
  "allowed": false,
  "offendingSegmentIds": [
    "offendingSegmentIds-1"
  ]
};

/** verifyCitation 的失败模式全集——界面的异常态必须逐个覆盖 */
export const verifyCitationErrors = ["RUN_NOT_FOUND","CITATION_OUT_OF_PACK"] as const;

/** pinContextPack 的成功响应样例（由契约生成） */
export const pinContextPackMock: z.infer<typeof contextPack.operations.pinContextPack.out> = {
  "snapshotId": "snapshotId-1",
  "contentHash": "contentHash-1",
  "frozenItemCount": 1
};

/** pinContextPack 的失败模式全集——界面的异常态必须逐个覆盖 */
export const pinContextPackErrors = ["RUN_NOT_FOUND","PIN_REQUIRES_SNAPSHOT"] as const;

/** resolvePackModelConstraint 的成功响应样例（由契约生成） */
export const resolvePackModelConstraintMock: z.infer<typeof contextPack.operations.resolvePackModelConstraint.out> = {
  "localOnly": false,
  "source": "promise",
  "reason": "reason-1",
  "confidentialItemCount": 1
};

/** resolvePackModelConstraint 的失败模式全集——界面的异常态必须逐个覆盖 */
export const resolvePackModelConstraintErrors = ["RUN_NOT_FOUND"] as const;

/** addManualItem 的成功响应样例（由契约生成） */
export const addManualItemMock: z.infer<typeof contextPack.operations.addManualItem.out> = {
  "packId": "packId-1",
  "runId": "runId-1",
  "query": {
    "tenantId": "tenantId-1",
    "principalId": "principalId-1",
    "projectIds": [
      "projectIds-1"
    ],
    "task": "search",
    "query": "query-1",
    "timeRange": null,
    "allowedSensitivity": [
      "allowedSensitivity-1"
    ],
    "tokenBudget": 1,
    "freshnessRequirement": null,
    "evidencePolicy": "primary-only"
  },
  "retrievalPlan": [
    {
      "channel": "fts",
      "weight": 1,
      "hitCount": 1
    }
  ],
  "items": [
    {
      "segmentId": "segmentId-1",
      "content": "content-1",
      "sourceType": "file",
      "artifactVersionId": "artifactVersionId-1",
      "anchor": {
        "page": 1,
        "bbox": [
          1
        ],
        "startMs": 1,
        "endMs": 1,
        "messageId": "messageId-1",
        "surveyQuestionId": "surveyQuestionId-1",
        "imageRegion": {
          "x": 1,
          "y": 1,
          "w": 1,
          "h": 1
        }
      },
      "retrievalReasons": [
        "recall"
      ],
      "channels": [
        "fts"
      ],
      "score": 1,
      "permissionDecisionId": "permissionDecisionId-1"
    }
  ],
  "claims": [
    {
      "statement": "statement-1",
      "status": "proposed",
      "supportingSegmentIds": [
        "supportingSegmentIds-1"
      ],
      "contradictingSegmentIds": [
        "contradictingSegmentIds-1"
      ]
    }
  ],
  "omissions": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ],
  "tokensUsed": 1,
  "pinnedSnapshotId": null
};

/** addManualItem 的失败模式全集——界面的异常态必须逐个覆盖 */
export const addManualItemErrors = ["RUN_NOT_FOUND","BUDGET_EXCEEDS_MANUAL","MANUAL_ITEM_UNAUTHORIZED"] as const;

/** adjustRetrievalWeights 的成功响应样例（由契约生成） */
export const adjustRetrievalWeightsMock: z.infer<typeof contextPack.operations.adjustRetrievalWeights.out> = {
  "packId": "packId-1",
  "runId": "runId-1",
  "query": {
    "tenantId": "tenantId-1",
    "principalId": "principalId-1",
    "projectIds": [
      "projectIds-1"
    ],
    "task": "search",
    "query": "query-1",
    "timeRange": null,
    "allowedSensitivity": [
      "allowedSensitivity-1"
    ],
    "tokenBudget": 1,
    "freshnessRequirement": null,
    "evidencePolicy": "primary-only"
  },
  "retrievalPlan": [
    {
      "channel": "fts",
      "weight": 1,
      "hitCount": 1
    }
  ],
  "items": [
    {
      "segmentId": "segmentId-1",
      "content": "content-1",
      "sourceType": "file",
      "artifactVersionId": "artifactVersionId-1",
      "anchor": {
        "page": 1,
        "bbox": [
          1
        ],
        "startMs": 1,
        "endMs": 1,
        "messageId": "messageId-1",
        "surveyQuestionId": "surveyQuestionId-1",
        "imageRegion": {
          "x": 1,
          "y": 1,
          "w": 1,
          "h": 1
        }
      },
      "retrievalReasons": [
        "recall"
      ],
      "channels": [
        "fts"
      ],
      "score": 1,
      "permissionDecisionId": "permissionDecisionId-1"
    }
  ],
  "claims": [
    {
      "statement": "statement-1",
      "status": "proposed",
      "supportingSegmentIds": [
        "supportingSegmentIds-1"
      ],
      "contradictingSegmentIds": [
        "contradictingSegmentIds-1"
      ]
    }
  ],
  "omissions": [
    {
      "ref": "ref-1",
      "reason": "withdrawn",
      "compliance": false,
      "explain": "explain-1"
    }
  ],
  "tokensUsed": 1,
  "pinnedSnapshotId": null
};

/** adjustRetrievalWeights 的失败模式全集——界面的异常态必须逐个覆盖 */
export const adjustRetrievalWeightsErrors = ["RUN_NOT_FOUND","RETRIEVAL_UNAVAILABLE"] as const;
