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
import * as provenance from "@repo/contracts/provenance";

/** queryProvenance 的成功响应样例（由契约生成） */
export const queryProvenanceMock: z.infer<typeof provenance.operations.queryProvenance.out> = {
  "events": [
    {
      "id": "id-1",
      "type": "ingested",
      "actorId": "actorId-1",
      "at": "at-1",
      "orgId": "orgId-1",
      "target": {
        "kind": "artifact",
        "id": "id-1"
      },
      "detail": {}
    }
  ],
  "nextCursor": null
};

/** queryProvenance 的失败模式全集——界面的异常态必须逐个覆盖 */
export const queryProvenanceErrors = ["NO_ORG_MEMBERSHIP","PROJECT_ROLE_INSUFFICIENT"] as const;
