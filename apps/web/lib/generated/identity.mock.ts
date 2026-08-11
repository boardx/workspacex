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
import * as identity from "@repo/contracts/identity";

/** authorize 的成功响应样例（由契约生成） */
export const authorizeMock: z.infer<typeof identity.operations.authorize.out> = {
  "allowed": false,
  "orgLayer": {
    "role": null,
    "teamId": null,
    "passed": false
  },
  "projectLayer": null,
  "scopeLayer": {
    "scope": "org-wide",
    "passed": false
  },
  "reasonCode": null,
  "decisionId": "decisionId-1"
};

/** authorizeBatch 的成功响应样例（由契约生成） */
export const authorizeBatchMock: z.infer<typeof identity.operations.authorizeBatch.out> = [
  {
    "allowed": false,
    "orgLayer": {
      "role": null,
      "teamId": null,
      "passed": false
    },
    "projectLayer": null,
    "scopeLayer": {
      "scope": "org-wide",
      "passed": false
    },
    "reasonCode": null,
    "decisionId": "decisionId-1"
  }
];

/** readContent 的成功响应样例（由契约生成） */
export const readContentMock: z.infer<typeof identity.operations.readContent.out> = {
  "itemId": "itemId-1",
  "layer": "personal",
  "status": "draft",
  "body": "body-1",
  "provenanceEventId": null
};

/** readContent 的失败模式全集——界面的异常态必须逐个覆盖 */
export const readContentErrors = ["NO_ORG_MEMBERSHIP","ORG_SCOPE_DENIED","NO_PROJECT_ROLE","PROJECT_ROLE_INSUFFICIENT","ADMIN_NOT_SUPERUSER","PERSONAL_LAYER_CLOSED"] as const;

/** getPersonalLayerSummary 的成功响应样例（由契约生成） */
export const getPersonalLayerSummaryMock: z.infer<typeof identity.operations.getPersonalLayerSummary.out> = {
  "userId": "userId-1",
  "itemCount": 1,
  "reasonCode": null
};

/** getPersonalLayerSummary 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getPersonalLayerSummaryErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** resolveIdentity 的成功响应样例（由契约生成） */
export const resolveIdentityMock: z.infer<typeof identity.operations.resolveIdentity.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any",
    "avatarUrl": null
  },
  "orgRole": "admin",
  "teamId": null,
  "projectRole": null,
  "groupId": null,
  "displayName": "displayName-1",
  "avatarUrl": null
};

/** resolveIdentity 的失败模式全集——界面的异常态必须逐个覆盖 */
export const resolveIdentityErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** uploadOwnAvatar 的成功响应样例（由契约生成） */
export const uploadOwnAvatarMock: z.infer<typeof identity.operations.uploadOwnAvatar.out> = {
  "avatarArtifactId": "avatarArtifactId-1",
  "avatarUrl": "avatarUrl-1"
};

/** uploadOwnAvatar 的失败模式全集——界面的异常态必须逐个覆盖 */
export const uploadOwnAvatarErrors = ["FILE_TOO_LARGE","UNSUPPORTED_CONTENT_TYPE"] as const;

/** updateOwnProfile 的成功响应样例（由契约生成） */
export const updateOwnProfileMock: z.infer<typeof identity.operations.updateOwnProfile.out> = {
  "displayName": "displayName-1",
  "avatarUrl": null
};

/** updateOwnProfile 的失败模式全集——界面的异常态必须逐个覆盖 */
export const updateOwnProfileErrors = ["INVALID_INPUT","AVATAR_ARTIFACT_NOT_OWNED"] as const;

/** changeOwnPassword 的成功响应样例（由契约生成） */
export const changeOwnPasswordMock: z.infer<typeof identity.operations.changeOwnPassword.out> = {
  "changed": true,
  "revokedSessionCount": 1
};

/** changeOwnPassword 的失败模式全集——界面的异常态必须逐个覆盖 */
export const changeOwnPasswordErrors = ["CURRENT_PASSWORD_INVALID","PASSWORD_POLICY_VIOLATION"] as const;

/** listOwnActivity 的成功响应样例（由契约生成） */
export const listOwnActivityMock: z.infer<typeof identity.operations.listOwnActivity.out> = {
  "events": [
    {
      "eventId": "eventId-1",
      "kind": "kind-1",
      "occurredAt": "occurredAt-1",
      "summary": "summary-1"
    }
  ],
  "nextCursor": null
};

/** switchOrganization 的成功响应样例（由契约生成） */
export const switchOrganizationMock: z.infer<typeof identity.operations.switchOrganization.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any",
    "avatarUrl": null
  },
  "capabilities": [
    {
      "id": "id-1",
      "orgId": "orgId-1",
      "kind": "agent",
      "name": "name-1",
      "scope": "org-wide",
      "enabled": false,
      "endpoint": null,
      "abbr": null,
      "duty": null,
      "disabledReason": null
    }
  ]
};

/** switchOrganization 的失败模式全集——界面的异常态必须逐个覆盖 */
export const switchOrganizationErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** listCapabilities 的成功响应样例（由契约生成） */
export const listCapabilitiesMock: z.infer<typeof identity.operations.listCapabilities.out> = [
  {
    "id": "id-1",
    "orgId": "orgId-1",
    "kind": "agent",
    "name": "name-1",
    "scope": "org-wide",
    "enabled": false,
    "endpoint": null,
    "abbr": null,
    "duty": null,
    "disabledReason": null
  }
];

/** listCapabilities 的失败模式全集——界面的异常态必须逐个覆盖 */
export const listCapabilitiesErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** mutateCapability 的成功响应样例（由契约生成） */
export const mutateCapabilityMock: z.infer<typeof identity.operations.mutateCapability.out> = {
  "listing": {
    "id": "id-1",
    "orgId": "orgId-1",
    "kind": "agent",
    "name": "name-1",
    "scope": "org-wide",
    "enabled": false,
    "endpoint": null,
    "abbr": null,
    "duty": null,
    "disabledReason": null
  },
  "provenanceEventId": "provenanceEventId-1",
  "affectedInFlightCalls": 1
};

/** mutateCapability 的失败模式全集——界面的异常态必须逐个覆盖 */
export const mutateCapabilityErrors = ["PROJECT_ROLE_INSUFFICIENT","ORG_SCOPE_DENIED"] as const;

/** resolveModelConstraint 的成功响应样例（由契约生成） */
export const resolveModelConstraintMock: z.infer<typeof identity.operations.resolveModelConstraint.out> = {
  "localOnly": false,
  "source": "promise",
  "reason": "reason-1"
};

/** resolveModelConstraint 的失败模式全集——界面的异常态必须逐个覆盖 */
export const resolveModelConstraintErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** getLocalOrg 的成功响应样例（由契约生成） */
export const getLocalOrgMock: z.infer<typeof identity.operations.getLocalOrg.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any",
    "avatarUrl": null
  },
  "guarantees": [
    {
      "id": "local-model-only",
      "statement": "statement-1"
    }
  ],
  "memberCount": 1,
  "canInvite": false,
  "storagePrefix": "storagePrefix-1"
};

/** getLocalOrg 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getLocalOrgErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** getLocalRuntimeStatus 的成功响应样例（由契约生成） */
export const getLocalRuntimeStatusMock: z.infer<typeof identity.operations.getLocalRuntimeStatus.out> = {
  "available": false,
  "endpoint": "endpoint-1",
  "failure": null
};

/** getLocalRuntimeStatus 的失败模式全集——界面的异常态必须逐个覆盖 */
export const getLocalRuntimeStatusErrors = ["NO_ORG_MEMBERSHIP","LOCAL_ORG_ONLY"] as const;

/** invokeLocalModel 的成功响应样例（由契约生成） */
export const invokeLocalModelMock: z.infer<typeof identity.operations.invokeLocalModel.out> = {
  "capabilityId": "capabilityId-1",
  "endpoint": "endpoint-1",
  "output": "output-1"
};

/** invokeLocalModel 的失败模式全集——界面的异常态必须逐个覆盖 */
export const invokeLocalModelErrors = ["NO_ORG_MEMBERSHIP","LOCAL_ORG_ONLY","CAPABILITY_NOT_FOUND","CLOUD_MODEL_FORBIDDEN","LOCAL_RUNTIME_UNAVAILABLE"] as const;

/** previewExport 的成功响应样例（由契约生成） */
export const previewExportMock: z.infer<typeof identity.operations.previewExport.out> = {
  "items": [
    {
      "artifactId": "artifactId-1",
      "title": "title-1",
      "willBeVisibleTo": [
        {
          "kind": "kind-1",
          "id": "id-1",
          "name": "name-1"
        }
      ]
    }
  ],
  "token": "token-1"
};

/** previewExport 的失败模式全集——界面的异常态必须逐个覆盖 */
export const previewExportErrors = ["NO_ORG_MEMBERSHIP","EXPORT_DIRECTION_FORBIDDEN"] as const;

/** exportToOrganization 的成功响应样例（由契约生成） */
export const exportToOrganizationMock: z.infer<typeof identity.operations.exportToOrganization.out> = {
  "copiedArtifactIds": [
    "copiedArtifactIds-1"
  ],
  "localProvenanceEventId": "localProvenanceEventId-1",
  "targetProvenanceEventId": "targetProvenanceEventId-1"
};

/** exportToOrganization 的失败模式全集——界面的异常态必须逐个覆盖 */
export const exportToOrganizationErrors = ["EXPORT_PREVIEW_REQUIRED","NO_ORG_MEMBERSHIP","EXPORT_DIRECTION_FORBIDDEN"] as const;
