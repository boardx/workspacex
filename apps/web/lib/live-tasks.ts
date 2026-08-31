/**
 * F02/F06 —— `/tasks` 的真实 API 薄封装（契约束 `board`）。
 *
 * 类型跟着后端的响应形状走（`apps/api/src/application/board/{get-my-today,list-tasks,
 * create-task}.ts` 的 `Output`/`Input`），后端目前还没有把这些形状搬进
 * `packages/contracts`（F01/F02 都是先接口后契约化，board 契约束目前只有
 * `packages/contracts/src/board.ts` 里的枚举），所以这里手写了响应类型——
 * 与 `lint-contract-source` 冲突的部分仅限枚举值（status/sourceKind/riskLevel 三个
 * 字符串联合都从 `@repo/contracts` 的 `board` 命名空间派生，不重新声明），
 * 响应体的对象形状本身允许先在这里手写，等 F04 之后再补齐契约化。
 *
 * ## 范围收窄（如实记录，与后端 `board.controller.ts` 一致）
 *
 * `GET /tasks/today` 和 `GET /tasks` 都需要一个 `projectId` 作为角色判定的锚点——
 * 后端还没做"多项目角色求并集"（那是 F04 的范围）。前端因此取调用方所在组织的
 * **第一个可见项目**作为锚点（`listProjects` 返回的 member 列表第一项），不是真正的
 * "跨全部项目"聚合；这是一个记录在案的过渡态，不是最终形态。
 */
import { board } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type TaskStatus = z.infer<typeof board.TaskStatus>;
export type SourceKind = z.infer<typeof board.SourceKind>;
export type RiskLevel = z.infer<typeof board.RiskLevel>;

export type ExecutorRef = { kind: "human" | "agent"; id: string } | null;

export interface RenderedTaskCard {
  id: string;
  title: string;
  status: TaskStatus;
  sourceKind: SourceKind;
  ownerUserId: string | null;
  executor: ExecutorRef;
  dueAt: string | null;
  riskLevel: RiskLevel | null;
  waitingOn: string | null;
  syncStatus: "synced" | "out_of_sync";
  projectId: string | null;
}

export interface MyTodaySections {
  awaiting_my_judgment: RenderedTaskCard[];
  my_push_today: RenderedTaskCard[];
  ai_running_for_me: RenderedTaskCard[];
  waiting_on_others: RenderedTaskCard[];
}

export type TodaySummary =
  | {
      sampleSufficient: false;
      aiCompletedCount: number;
      label: "样本不足";
      waitingAuthzCount: number;
      waitingAuthzKnown: false;
    }
  | {
      sampleSufficient: true;
      aiCompletedCount: number;
      personHours: number;
      coefficientTableVersion: string;
      waitingAuthzCount: number;
      waitingAuthzKnown: false;
    };

export interface GetMyTodayOut {
  sections: MyTodaySections;
  summary: TodaySummary;
}

export async function getMyToday(projectId: string): Promise<GetMyTodayOut> {
  return apiRequest<GetMyTodayOut>("/tasks/today", { query: { projectId } });
}

export interface ListTasksOut {
  cards: RenderedTaskCard[];
  scope: "project" | "global";
  columns: { status: string; cardIds: string[] }[];
  collapsedInboxCount: number;
  badgeCount: number;
  footer: { overdue: number; dueToday: number };
  noCardLoss: boolean;
}

export async function listTasks(projectId: string, scope: "project" | "global" = "project"): Promise<ListTasksOut> {
  return apiRequest<ListTasksOut>("/tasks", { query: { projectId, scope } });
}

export interface CreateTaskInput {
  projectId?: string | null;
  title: string;
  ownerUserId: string;
  executor?: string | null;
  dueAt?: string | null;
  riskLevel?: string | null;
  waitingOn?: string | null;
  status?: string;
}

export interface CreateTaskOut {
  id: string;
  status: TaskStatus;
  sourceKind: SourceKind;
}

export async function createTask(input: CreateTaskInput): Promise<CreateTaskOut> {
  return apiRequest<CreateTaskOut>("/tasks", { method: "POST", body: input });
}

export interface ChangeTaskStatusOut {
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  auditEventId: string | null;
  syncStatus: "synced" | "out_of_sync";
  writebackFailureReason: string | null;
}

export async function changeTaskStatus(
  taskId: string,
  toStatus: TaskStatus,
  reason?: string | null,
): Promise<ChangeTaskStatusOut> {
  return apiRequest<ChangeTaskStatusOut>(`/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "PATCH",
    body: { toStatus, reason: reason ?? null },
  });
}
