/**
 * CT10 —— Board 运行卡读模型的真实 API 薄封装（契约 work-content.operations.listBoardRunCards）。
 * 路径与形状单源自 `@repo/contracts/work-content`；服务端已先按读权限过滤再投影，这里不合成卡。
 */
import { operations } from "@repo/contracts/work-content";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const OP = operations.listBoardRunCards;

export type BoardRunCardsResponse = z.infer<typeof OP.out>;

export async function listBoardRunCards(projectId?: string | null): Promise<BoardRunCardsResponse> {
  const raw: unknown = await apiRequest(OP.path, { query: { projectId: projectId ?? undefined } });
  return OP.out.parse(raw);
}
