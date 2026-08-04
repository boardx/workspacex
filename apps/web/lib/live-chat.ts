/**
 * F368 —— 对话束的真实 API 薄封装，供 `/chat/live` 页面使用。
 *
 * 与 `lib/live-projects.ts`（F122）同一个纪律：类型全部从 `@repo/contracts` 推导，
 * 不重新声明；一律经 `apiRequest`，不各自 `fetch`。
 *
 * ## 只封装了「已确认有真实 Postgres 支撑」的用例
 *
 * `apps/api/src/kernel.module.ts` 里 `CHAT_REPOSITORY`（`PgChatRepository`）与
 * `CHAT_PRESET_REPOSITORY`（`PgChatPresetRepository`）都是真实绑定，`chat.controller.ts`
 * 里对应的路由全部落到这两个仓储或共享的 `ProvenanceWriter`/`ProvenanceReader`
 * （`provenance_events`，`identity`/`artifact` 束共用的同一张审计表）上——不是
 * fixture。本文件只封装这些：
 *   · listThreads / getThread / getAgentPanel / mutateThread（线程列表/详情/只读 roster/新建-改名-删除）
 *   · updateAgentRoster（线程 agent 编制的增删，#467）
 *   · upsertPreset / dispatchPreset / startPresetInstance / getPresetUsage（预设三件套）
 *   · listMessages / createMessage（Wave 2 durable message + queued AgentRun acceptance）
 *
 * ⚠ 契约里还有 `getThreadMessagesFile`、`expandToolCallChain`、`locateCitation`、
 *   `adminAuditRead`、approval-request/background-task/artifact 几条——同样是真实
 *   Postgres/Provenance 支撑，但不在本次「核心聊天路径」范围内，故未封装，
 *   见 issue #368 的核实报告。
 *
 * ⚠ `updateAgentRoster` 曾**逐字写在上面那条「未封装」清单里**，#467 把它接上了，
 *   于是把它从清单移到已封装那一栏。留着旧措辞就会变成一句会说谎的注释——
 *   本仓已因此类注释踩过多次，注释与代码同属一次改动，不是可选项。
 *
 * Wave 2 的消息写入只接受 human message + selected published Agent。成功响应是 durable
 * human message 与 queued run identity，永不在客户端合成 inline Agent reply。
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
export type DurableMessage = z.infer<typeof chat.DurableMessage>;
export type ListMessagesOut = z.infer<typeof chat.operations.listMessages.out>;
export type CreateMessageOut = z.infer<typeof chat.operations.createMessage.out>;
export type CreateMessageInput = Omit<z.input<typeof chat.operations.createMessage.in>, "threadId">;
export type UpdateAgentRosterOut = z.infer<typeof chat.operations.updateAgentRoster.out>;
/** `threadId` 由入参单独给（要拼进路径），其余字段照契约原样透传。 */
export type UpdateAgentRosterInput = Omit<
  z.input<typeof chat.operations.updateAgentRoster.in>,
  "threadId"
>;

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

/**
 * 改本线程的 agent 编制（#467）。
 *
 * ⚠ `projectId` 走 **query**、其余走 **body**：控制器把它读作 `@Query`
 *   （`apps/api/src/interface/controllers/chat.controller.ts:590`），而 body 过
 *   契约的 `.strict()`——把 `projectId` 塞进 body 会被拒。与 `getAgentPanel`
 *   同一个落法，不是本函数特有的怪癖。
 *
 * ⚠ **调用方要自己维护 `expectedRosterVersion`**：全契约只有本端口的**出参**带
 *   `rosterVersion`（`packages/contracts/src/chat.ts:509`），**没有任何读端口下发它**
 *   （`getAgentPanel.out` 同文件 :477 里没有）。⇒ 只能从 `chat_threads.roster_version`
 *   的 DDL 默认值 0 起步、再用每次响应返回的值推进。这是**已上报的契约缺口**，
 *   不是这里可以自己发明一个字段补上的东西；并发冲突照契约回 409 `VERSION_CHANGED`，
 *   由调用方如实呈现，**不得静默重试**（「部分成功即整体拒绝」）。
 */
export async function updateAgentRoster(
  threadId: string,
  projectId: string,
  input: UpdateAgentRosterInput,
  sessionToken?: string,
): Promise<UpdateAgentRosterOut> {
  return apiRequest<UpdateAgentRosterOut>(
    chat.operations.updateAgentRoster.path.replace(":threadId", encodeURIComponent(threadId)),
    {
      method: "POST",
      query: { projectId },
      body: { threadId, ...input },
      sessionToken,
    },
  );
}

export async function listMessages(
  threadId: string,
  opts: { cursor?: string; limit?: number } = {},
  sessionToken?: string,
): Promise<ListMessagesOut> {
  return apiRequest<ListMessagesOut>(
    chat.operations.listMessages.path.replace(":threadId", encodeURIComponent(threadId)),
    {
      method: "GET",
      query: {
        cursor: opts.cursor,
        limit: opts.limit === undefined ? undefined : String(opts.limit),
      },
      sessionToken,
    },
  );
}

export async function createMessage(
  threadId: string,
  input: CreateMessageInput,
  sessionToken?: string,
): Promise<CreateMessageOut> {
  return apiRequest<CreateMessageOut>(
    chat.operations.createMessage.path.replace(":threadId", encodeURIComponent(threadId)),
    {
      method: "POST",
      body: input,
      sessionToken,
    },
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
