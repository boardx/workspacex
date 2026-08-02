/**
 * #356 —— 真实 interview-scope 数据的类型化薄封装，供 `/itv/live` 页面使用。
 *
 * 与 `lib/live-projects.ts`（F122）同一纪律：类型全部从 `@repo/contracts` 推导，
 * 不重新声明——同一份形状两处声明正是本仓 AGENTS.md 点名的事故模式。
 *
 * ⚠ 这里**只**封装 `interview-scope.controller.ts` 真实暴露的两条读路由
 * （`GET /interviews`、`GET /interviews/:interviewId`）。契约 `interview.ts` 里其余
 * 几十个 operations（模板库/向导/研究设计/证据矩阵/洞察报告……）在 interface 层
 * **没有对应的 controller**（`apps/api/src/interface/controllers/` 下只有这一个
 * interview 相关文件）——见 #356 的调查结论。不在这里假装封装它们。
 */
import { auth, interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type InterviewRow = z.infer<typeof interview.InterviewRow>;
export type InterviewScope = z.infer<typeof interview.InterviewScope>;
export type ListInterviewsOut = z.infer<typeof interview.operations.listInterviews.out>;
export type GetInterviewOut = z.infer<typeof interview.operations.getInterview.out>;
export type LoginOut = z.infer<typeof auth.operations.login.out>;

export async function login(email: string, password: string): Promise<LoginOut> {
  return apiRequest<LoginOut>(auth.operations.login.path, {
    method: "POST",
    body: { email, password },
    sessionToken: null,
  });
}

export interface ListInterviewsInput {
  readonly scope: InterviewScope;
  readonly tags?: string[] | null;
  readonly archived?: boolean | null;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * 查询串组装成契约 `listInterviews.in` 期望的对象形状——同
 * `interview-scope.controller.ts` `list()` 的映射规则（三个 scope 字段 + 两个
 * filter 字段），这一层的编码决定与 controller 那一层各自独立各写一次，
 * 契约本身只规定对象形状不规定查询串形状。
 */
export async function listInterviews(input: ListInterviewsInput): Promise<ListInterviewsOut> {
  return apiRequest<ListInterviewsOut>(interview.operations.listInterviews.path, {
    method: "GET",
    query: {
      scopeKind: input.scope.kind,
      projectId: input.scope.projectId ?? undefined,
      researchProjectId: input.scope.researchProjectId ?? undefined,
      tags: input.tags && input.tags.length > 0 ? input.tags.join(",") : undefined,
      archived: input.archived === null || input.archived === undefined ? undefined : String(input.archived),
      cursor: input.cursor,
      limit: input.limit === undefined ? undefined : String(input.limit),
    },
  });
}

export async function getInterview(interviewId: string): Promise<GetInterviewOut> {
  return apiRequest<GetInterviewOut>(
    interview.operations.getInterview.path.replace(":interviewId", encodeURIComponent(interviewId)),
    { method: "GET" },
  );
}
