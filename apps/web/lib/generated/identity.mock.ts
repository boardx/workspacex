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
    "role": "admin",
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
      "role": "admin",
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

/** resolveIdentity 的成功响应样例（由契约生成） */
export const resolveIdentityMock: z.infer<typeof identity.operations.resolveIdentity.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any"
  },
  "orgRole": "admin",
  "teamId": null,
  "projectRole": null,
  "groupId": null
};

/** resolveIdentity 的失败模式全集——界面的异常态必须逐个覆盖 */
export const resolveIdentityErrors = ["NO_ORG_MEMBERSHIP"] as const;

/** switchOrganization 的成功响应样例（由契约生成） */
export const switchOrganizationMock: z.infer<typeof identity.operations.switchOrganization.out> = {
  "org": {
    "id": "id-1",
    "name": "name-1",
    "kind": "organization",
    "team": null,
    "modelPolicy": "any"
  },
  "capabilities": [
    {
      "id": "id-1",
      "orgId": "orgId-1",
      "kind": "agent",
      "name": "name-1",
      "scope": "org-wide",
      "enabled": false
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
    "enabled": false
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
    "enabled": false
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
