/**
 * F05（phase-10 `group-checkin` 束）—— 分组签到聚合视图的真实 API 薄封装。
 *
 * ⚠ 契约用的是 `orgAdmin.operations.getCheckinBoard`，**不是**
 *   `group-checkin` 束 `design-signoff.md` ③ 原本设想的新文件
 *   `packages/contracts/src/live-collab-checkin.ts`——那份契约（连同用例
 *   `apps/api/src/application/auth/get-checkin-board.ts` 与仓储实现）
 *   其实是更早的 F16（UC-1.3 R8）已经做好的，只是当时没有路由接它、
 *   也没有前端消费。本文件与 `apps/api/src/interface/controllers/checkin-board.controller.ts`
 *   是把这条早已存在的用例第一次接成端到端可用的两处改动。
 */
import { orgAdmin } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type CheckinBoardOut = z.infer<typeof orgAdmin.operations.getCheckinBoard.out>;
export type CheckinGroupRow = CheckinBoardOut["groups"][number];

export async function getCheckinBoard(projectId: string): Promise<CheckinBoardOut> {
  return apiRequest<CheckinBoardOut>(
    orgAdmin.operations.getCheckinBoard.path.replace(":projectId", encodeURIComponent(projectId)),
    { method: "GET" },
  );
}
