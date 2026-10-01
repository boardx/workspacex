/**
 * WS05 —— Work Skill 目录（契约束 `work-skill-meta`）的前端薄封装。
 *
 * 形状与路径全部来自 `@repo/contracts` 的 `workSkillMeta`（单一事实源）；这一层不做权限判断，
 * 失败以 `ApiError` 原样抛给调用方（`canManageChannel` 由服务端给出，UI 只据此决定是否渲染入口）。
 */
import { workEval, workSkillMeta } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const ops = workSkillMeta.operations;

export type WorkSkillCatalogItem = z.infer<typeof workSkillMeta.WorkSkillCatalogItem>;
export type WorkSkillCatalogDetail = z.infer<typeof workSkillMeta.WorkSkillCatalogDetail>;
export type WorkSkillReadiness = z.infer<typeof workSkillMeta.SkillReadiness>;
export type WorkSkillChannel = z.infer<typeof workSkillMeta.WorkSkillChannel>;
type ListOut = z.infer<typeof ops.listWorkSkillCatalog.out>;

export interface WorkSkillCatalogQuery {
  readonly domain?: string;
  readonly channel?: WorkSkillChannel;
  readonly q?: string;
  readonly includeDeprecated: boolean;
  readonly cursor?: string;
}

function withId(path: string, skillId: string): string {
  return path.replace(":skillId", encodeURIComponent(skillId));
}

export async function listWorkSkillCatalog(query: WorkSkillCatalogQuery): Promise<ListOut> {
  const q = query.q?.trim();
  return apiRequest<ListOut>(ops.listWorkSkillCatalog.path, {
    method: "GET",
    query: {
      domain: query.domain || undefined,
      channel: query.channel,
      q: q ? q : undefined,
      includeDeprecated: query.includeDeprecated ? "true" : "false",
      cursor: query.cursor,
    },
  });
}

export async function getWorkSkillCatalogEntry(skillId: string): Promise<WorkSkillCatalogDetail> {
  return apiRequest<WorkSkillCatalogDetail>(withId(ops.getWorkSkillCatalogEntry.path, skillId), { method: "GET" });
}

export async function getWorkSkillReadiness(skillId: string): Promise<WorkSkillReadiness> {
  return apiRequest<WorkSkillReadiness>(withId(ops.getWorkSkillReadiness.path, skillId), { method: "GET" });
}

export interface UpdateWorkSkillCatalogInput {
  readonly expectedChannel: WorkSkillChannel;
  readonly channel?: WorkSkillChannel;
  readonly successorSkillId?: string | null;
  readonly gateEvidenceRef?: string;
  readonly idempotencyKey: string;
}

export async function updateWorkSkillCatalogEntry(
  skillId: string,
  input: UpdateWorkSkillCatalogInput,
): Promise<WorkSkillCatalogItem> {
  return apiRequest<WorkSkillCatalogItem>(withId(ops.updateWorkSkillCatalogEntry.path, skillId), {
    method: "PATCH",
    body: input,
  });
}

/** 合法通道转移（R7），直接引用契约常量，不在前端复述。 */
export const WORK_SKILL_CHANNEL_TRANSITIONS = workSkillMeta.WORK_SKILL_CHANNEL_TRANSITIONS;

/* ── EV04：门状态（契约束 `work-eval`，getWorkGateStatus） ─────────────── */

export type WorkGateView = z.infer<typeof workEval.WorkGateView>;
export type WorkGateBadgeState = z.infer<typeof workEval.WorkGateBadgeState>;

export async function getWorkGateStatus(skillId: string, versionId?: string): Promise<WorkGateView> {
  return apiRequest<WorkGateView>(withId(workEval.operations.getWorkGateStatus.path, skillId), {
    method: "GET",
    query: { versionId },
  });
}
