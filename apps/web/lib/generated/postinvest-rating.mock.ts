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
import * as postinvestRating from "@repo/contracts/postinvest-rating";

/** createRatingRun 的成功响应样例（由契约生成） */
export const createRatingRunMock: z.infer<typeof postinvestRating.operations.createRatingRun.out> = {
  "runId": "runId-1",
  "recordId": "recordId-1"
};

/** createRatingRun 的失败模式全集——界面的异常态必须逐个覆盖 */
export const createRatingRunErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","NO_FINANCIAL_STATEMENT","AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD","KERNEL_UNAVAILABLE","SANDBOX_UNAVAILABLE"] as const;

/** getRatingRecord 的成功响应样例（由契约生成） */
export const getRatingRecordMock: z.infer<typeof postinvestRating.operations.getRatingRecord.out> = {
  "id": "id-1",
  "projectId": "projectId-1",
  "version": 1,
  "status": "draft",
  "grade": null,
  "gradeMeta": null,
  "flags": [
    "normal"
  ],
  "scores": {
    "s1": null,
    "s2": null,
    "s3": null,
    "total": null,
    "intermediates": {},
    "scriptVersion": "scriptVersion-1"
  },
  "evidence": [
    {
      "field": "field-1",
      "value": null,
      "unit": "unit-1",
      "sourceFileId": "sourceFileId-1",
      "sourceLocator": "sourceLocator-1",
      "scoreComponent": "S1"
    }
  ],
  "uncertainties": [
    "uncertainties-1"
  ],
  "discardedOffWhitelistCount": 1,
  "inputFiles": [
    {
      "fileId": "fileId-1",
      "filename": "filename-1",
      "sha256": "sha256-1",
      "kind": "statement"
    }
  ],
  "reports": [
    {
      "artifactId": "artifactId-1",
      "kind": "pdf",
      "verified": false
    }
  ],
  "runId": "runId-1",
  "createdAt": "createdAt-1",
  "confirmedBy": "confirmedBy-1",
  "confirmedAt": "confirmedAt-1",
  "corrections": [
    {
      "feedbackId": "feedbackId-1",
      "type": "calc_error",
      "before": null,
      "after": null,
      "basis": "basis-1",
      "createdAt": "createdAt-1"
    }
  ]
};

/** getRatingRecord 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getRatingRecordErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","RECORD_NOT_FOUND"] as const;

/** listRatingRecords 的成功响应样例（由契约生成） */
export const listRatingRecordsMock: z.infer<typeof postinvestRating.operations.listRatingRecords.out> = {
  "projectId": "projectId-1",
  "versions": [
    {
      "id": "id-1",
      "projectId": "projectId-1",
      "version": 1,
      "status": "draft",
      "grade": null,
      "gradeMeta": null,
      "flags": [
        "normal"
      ],
      "scores": {
        "s1": null,
        "s2": null,
        "s3": null,
        "total": null,
        "intermediates": {},
        "scriptVersion": "scriptVersion-1"
      },
      "evidence": [
        {
          "field": "field-1",
          "value": null,
          "unit": "unit-1",
          "sourceFileId": "sourceFileId-1",
          "sourceLocator": "sourceLocator-1",
          "scoreComponent": "S1"
        }
      ],
      "uncertainties": [
        "uncertainties-1"
      ],
      "discardedOffWhitelistCount": 1,
      "inputFiles": [
        {
          "fileId": "fileId-1",
          "filename": "filename-1",
          "sha256": "sha256-1",
          "kind": "statement"
        }
      ],
      "reports": [
        {
          "artifactId": "artifactId-1",
          "kind": "pdf",
          "verified": false
        }
      ],
      "runId": "runId-1",
      "createdAt": "createdAt-1",
      "confirmedBy": "confirmedBy-1",
      "confirmedAt": "confirmedAt-1",
      "corrections": [
        {
          "feedbackId": "feedbackId-1",
          "type": "calc_error",
          "before": null,
          "after": null,
          "basis": "basis-1",
          "createdAt": "createdAt-1"
        }
      ]
    }
  ]
};

/** listRatingRecords 的失败模式全集——界面的异常态必须逐个覆盖 */
export const listRatingRecordsErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE"] as const;

/** submitFeedback 的成功响应样例（由契约生成） */
export const submitFeedbackMock: z.infer<typeof postinvestRating.operations.submitFeedback.out> = {
  "feedbackId": "feedbackId-1",
  "outcome": "recorded_only",
  "newRecordId": "newRecordId-1"
};

/** submitFeedback 的失败模式全集——界面的异常态必须逐个覆盖 */
export const submitFeedbackErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","RECORD_NOT_FOUND","RECORD_ALREADY_CONFIRMED","FEEDBACK_TYPE_REQUIRED","PARSE_FAILED","SCRIPT_FAILED_AFTER_RETRIES","SANDBOX_TIMEOUT","SANDBOX_UNAVAILABLE","KERNEL_UNAVAILABLE"] as const;

/** confirmRatingRecord 的成功响应样例（由契约生成） */
export const confirmRatingRecordMock: z.infer<typeof postinvestRating.operations.confirmRatingRecord.out> = {
  "id": "id-1",
  "projectId": "projectId-1",
  "version": 1,
  "status": "draft",
  "grade": null,
  "gradeMeta": null,
  "flags": [
    "normal"
  ],
  "scores": {
    "s1": null,
    "s2": null,
    "s3": null,
    "total": null,
    "intermediates": {},
    "scriptVersion": "scriptVersion-1"
  },
  "evidence": [
    {
      "field": "field-1",
      "value": null,
      "unit": "unit-1",
      "sourceFileId": "sourceFileId-1",
      "sourceLocator": "sourceLocator-1",
      "scoreComponent": "S1"
    }
  ],
  "uncertainties": [
    "uncertainties-1"
  ],
  "discardedOffWhitelistCount": 1,
  "inputFiles": [
    {
      "fileId": "fileId-1",
      "filename": "filename-1",
      "sha256": "sha256-1",
      "kind": "statement"
    }
  ],
  "reports": [
    {
      "artifactId": "artifactId-1",
      "kind": "pdf",
      "verified": false
    }
  ],
  "runId": "runId-1",
  "createdAt": "createdAt-1",
  "confirmedBy": "confirmedBy-1",
  "confirmedAt": "confirmedAt-1",
  "corrections": [
    {
      "feedbackId": "feedbackId-1",
      "type": "calc_error",
      "before": null,
      "after": null,
      "basis": "basis-1",
      "createdAt": "createdAt-1"
    }
  ]
};

/** confirmRatingRecord 的失败模式全集——界面的异常态必须逐个覆盖 */
export const confirmRatingRecordErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","RECORD_NOT_FOUND","RECORD_ALREADY_CONFIRMED","ADMIN_CANNOT_CONFIRM"] as const;

/** getTrustedSourceWhitelist 的成功响应样例（由契约生成） */
export const getTrustedSourceWhitelistMock: z.infer<typeof postinvestRating.operations.getTrustedSourceWhitelist.out> = {
  "domains": [
    "domains-1"
  ],
  "updatedBy": null,
  "updatedAt": "updatedAt-1"
};

/** getTrustedSourceWhitelist 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getTrustedSourceWhitelistErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE"] as const;

/** updateTrustedSourceWhitelist 的成功响应样例（由契约生成） */
export const updateTrustedSourceWhitelistMock: z.infer<typeof postinvestRating.operations.updateTrustedSourceWhitelist.out> = {
  "domains": [
    "domains-1"
  ],
  "updatedBy": null,
  "updatedAt": "updatedAt-1"
};

/** updateTrustedSourceWhitelist 的失败模式全集——界面的异常态必须逐个覆盖 */
export const updateTrustedSourceWhitelistErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","WHITELIST_INVALID_DOMAIN"] as const;

/** decideRatingHitl 的成功响应样例（由契约生成） */
export const decideRatingHitlMock: z.infer<typeof postinvestRating.operations.decideRatingHitl.out> = {
  "runId": "runId-1",
  "decision": "approve"
};

/** decideRatingHitl 的失败模式全集——界面的异常态必须逐个覆盖 */
export const decideRatingHitlErrors = ["NO_PROJECT_ROLE","ORG_NOT_ELIGIBLE","RUN_NOT_AWAITING_HITL","KERNEL_UNAVAILABLE"] as const;
