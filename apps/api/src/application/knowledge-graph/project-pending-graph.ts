/**
 * Phase 18 F04 —— 投影一轮：每个有待投影行的 org 各跑一次。
 *
 * 一个 org 失败（AGE 挂了、图查询报错）不影响别的 org，也不影响任何 canonical 写入——
 * 它们本来就不在同一个事务里。失败的 org 下一轮再试；AGE 长时间不可用后恢复，用 `pnpm graph:rebuild` 全量重建。
 */
import type { LoggerPort } from "../ports/logger.port";
import type { OrgId } from "../../domain/org-id";
import type { GraphProjectionPort } from "./ports";

export const KG_PROJECTION_BATCH = 500;

export interface ProjectionTickResult {
  readonly projected: number;
  readonly failedOrgs: readonly OrgId[];
  /** 数据库里根本没有 AGE（桌面版 PGlite、或 CN 镜像未更新 #4081）。不是故障，是部署形态。 */
  readonly graphUnavailable: boolean;
}

const isGraphUnavailable = (err: unknown) => err instanceof Error && err.message.includes("KG_GRAPH_UNAVAILABLE");

export async function projectPendingGraph(port: GraphProjectionPort, logger: LoggerPort): Promise<ProjectionTickResult> {
  let projected = 0;
  let graphUnavailable = false;
  const failedOrgs: OrgId[] = [];
  for (const orgId of await port.pendingOrgs()) {
    try {
      projected += await port.projectPending(orgId, KG_PROJECTION_BATCH);
    } catch (err) {
      failedOrgs.push(orgId);
      if (isGraphUnavailable(err)) {
        // 没装 AGE 时每个 org 都会同样失败；报一次就够，调用方据此退避。
        if (!graphUnavailable) logger.info("kg graph projection skipped: AGE not installed", { traceId: "kg-projection" });
        graphUnavailable = true;
        continue;
      }
      logger.error("kg graph projection failed", { traceId: "kg-projection", orgId, err });
    }
  }
  return { projected, failedOrgs, graphUnavailable };
}
