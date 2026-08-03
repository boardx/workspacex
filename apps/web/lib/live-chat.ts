/**
 * F368 —— 对话束的真实 API 薄封装，供 `/chat/live` 页面使用。
 *
 * 与 `lib/live-projects.ts`（F122）同一个纪律：类型全部从 `@repo/contracts` 推导，
 * 不重新声明；一律经 `apiRequest`，不各自 `fetch`。
 *
 * ## 只封装了「已确认有真实 Postgres 支撑」的用例（issue #368 的核实结论）
 *
 * `apps/api/src/kernel.module.ts` 里 `CHAT_REPOSITORY`（`PgChatRepository`）与
 * `CHAT_PRESET_REPOSITORY`（`PgChatPresetRepository`）都是真实绑定，`chat.controller.ts`
 * 里对应的路由全部落到这两个仓储或共享的 `ProvenanceWriter`/`ProvenanceReader`
 * （`provenance_events`，`identity`/`artifact` 束共用的同一张审计表）上——不是
 * fixture。本文件只封装这些：
 *   · listThreads / getThread / getAgentPanel / mutateThread（线程列表/详情/只读 roster/新建-改名-删除）
 *   · upsertPreset / dispatchPreset / startPresetInstance / getPresetUsage（预设三件套）
 *
 * ⚠ 契约里还有 `getThreadMessagesFile`、`updateAgentRoster`、
 *   `expandToolCallChain`、`locateCitation`、`adminAuditRead`、approval-request/
 *   background-task/artifact 几条——同样是真实 Postgres/Provenance 支撑，
 *   但不在本次「核心聊天路径」范围内，故未封装，见 issue #368 的核实报告。
 *
 * ⚠ **没有「发消息」端口**：契约与控制器里都不存在任何
 *   `POST /chat/threads/:threadId/messages` 之类的写端口——`getThread.out.messages`
 *   只读，消息正文走 file-first 管线（`messages.jsonl`，见 `get-thread-messages-file.ts`
 *   头部注释），不是这里能补的「一个小仓储」级别的缺口，故本文件不假装有发消息 API。
 */
import { chat } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type ThreadCard = z.infer<typeof chat.ThreadCard>;
export type ListThreadsOut = z.infer<typeof chat.operations.listThreads.out>;
export type GetThreadOut = z.infer<typeof chat.operations.getThread.out>;
export type GetAgentPanelOut = z.infer<typeof chat.operations.getAgentPanel.out>;
export type MutateThreadOut = z.infer<typeof chat.operations.mutateThread.out>;
export type UpsertPresetOut = z.infer<typeof chat.operations.upsertPreset.out>;
export type DispatchPresetOut = z.infer<typeof chat.operations.dispatchPreset.out>;
export type StartPresetInstanceOut = z.infer<typeof chat.operations.startPresetInstance.out>;
export type GetPresetUsageOut = z.infer<typeof chat.operations.getPresetUsage.out>;

export async function listThreads(
  projectId: string,
  opts: { includeArchived?: boolean; filter?: "all" | "project" | "my-agents" } = {},
  sessionToken?: string,
): Promise<ListThreadsOut> {
  return apiRequest<ListThreadsOut>(
    chat.operations.listThreads.path.replace(":projectId", encodeURIComponent(projectId)),
    {
      method: "GET",
      query: {
        includeArchived: opts.includeArchived === undefined ? undefined : String(opts.includeArchived),
        filter: opts.filter,
      },
      sessionToken,
    },
  );
}

export async function getThread(
  threadId: string,
  projectId: string,
  sessionToken?: string,
): Promise<GetThreadOut> {
  return apiRequest<GetThreadOut>(
    chat.operations.getThread.path.replace(":threadId", encodeURIComponent(threadId)),
    { method: "GET", query: { projectId }, sessionToken },
  );
}

export async function getAgentPanel(
  threadId: string,
  projectId: string,
  sessionToken?: string,
): Promise<GetAgentPanelOut> {
  return apiRequest<GetAgentPanelOut>(
    chat.operations.getAgentPanel.path.replace(":threadId", encodeURIComponent(threadId)),
    { method: "GET", query: { projectId }, sessionToken },
  );
}

export interface CreateThreadInput {
  readonly projectId: string;
  readonly groupId: string | null;
  readonly title: string;
  readonly visibilityScope: z.infer<typeof chat.ChatVisibility>;
}

export async function createThread(input: CreateThreadInput): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "create",
      projectId: input.projectId,
      threadId: null,
      groupId: input.groupId,
      title: input.title,
      visibilityScope: input.visibilityScope,
      expectedVersion: null,
      reason: null,
    },
  });
}

export async function renameThread(
  threadId: string,
  title: string,
  expectedVersion: number,
): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "rename",
      projectId: null,
      threadId,
      groupId: null,
      title,
      visibilityScope: null,
      expectedVersion,
      reason: null,
    },
  });
}

export async function deleteThread(
  threadId: string,
  expectedVersion: number,
  reason: string,
): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "delete",
      projectId: null,
      threadId,
      groupId: null,
      title: null,
      visibilityScope: null,
      expectedVersion,
      reason,
    },
  });
}

export interface UpsertPresetInput {
  readonly projectId: string;
  readonly presetId: string | null;
  readonly openingPrompt: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly expectedVersion: number | null;
}

export async function upsertPreset(input: UpsertPresetInput): Promise<UpsertPresetOut> {
  return apiRequest<UpsertPresetOut>(
    chat.operations.upsertPreset.path.replace(":projectId", encodeURIComponent(input.projectId)),
    {
      method: "POST",
      body: {
        projectId: input.projectId,
        presetId: input.presetId,
        openingPrompt: input.openingPrompt,
        skills: [...input.skills],
        agents: [...input.agents],
        expectedVersion: input.expectedVersion,
      },
    },
  );
}

export async function dispatchPreset(
  presetId: string,
  targets: { plenary: boolean | null; groupIds: readonly string[] | null; roles: readonly string[] | null },
): Promise<DispatchPresetOut> {
  return apiRequest<DispatchPresetOut>(
    chat.operations.dispatchPreset.path.replace(":presetId", encodeURIComponent(presetId)),
    {
      method: "POST",
      body: {
        presetId,
        targets: {
          plenary: targets.plenary,
          groupIds: targets.groupIds === null ? null : [...targets.groupIds],
          roles: targets.roles === null ? null : [...targets.roles],
        },
      },
    },
  );
}

export async function startPresetInstance(presetId: string): Promise<StartPresetInstanceOut> {
  return apiRequest<StartPresetInstanceOut>(
    chat.operations.startPresetInstance.path.replace(":presetId", encodeURIComponent(presetId)),
    { method: "POST", body: { presetId } },
  );
}

export async function getPresetUsage(presetId: string): Promise<GetPresetUsageOut> {
  return apiRequest<GetPresetUsageOut>(
    chat.operations.getPresetUsage.path.replace(":presetId", encodeURIComponent(presetId)),
    { method: "GET" },
  );
}

export const CHAT_VISIBILITY_OPTIONS = chat.ChatVisibility.options;
