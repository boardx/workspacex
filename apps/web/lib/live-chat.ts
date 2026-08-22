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
 *   · listThreadArtifacts / landAsArtifact（右栏产物列表 + 落地为草稿产物，#708）
 *
 * ⚠ 契约里还有 `getThreadMessagesFile`、`expandToolCallChain`、`locateCitation`、
 *   `adminAuditRead`、approval-request/background-task 几条——同样是真实
 *   Postgres/Provenance 支撑，但不在本次「核心聊天路径」范围内，故未封装，
 *   见 issue #368 的核实报告。
 *
 * ⚠ `updateAgentRoster` / `listThreadArtifacts` / `landAsArtifact` 都曾**逐字写在
 *   上面那条「未封装」清单里**（分别是 #467、#708 接上的），于是把它们从清单移到
 *   已封装那一栏。留着旧措辞就会变成一句会说谎的注释——本仓已因此类注释踩过多次，
 *   注释与代码同属一次改动，不是可选项。
 *
 * Wave 2 的消息写入只接受 human message + selected published Agent。成功响应是 durable
 * human message 与 queued run identity，永不在客户端合成 inline Agent reply。
 */
import { agentDefaults, chat, chatFileUpload } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, apiUrl, ApiError, extractReasonCode, getStoredSessionToken } from "./api-client";

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
/**
 * 十项 UX 缺口第 4/5 项（issue #708）—— 产物落地。
 * `chat_artifact_landings` 真实落库支撑，`GET/POST /chat/threads/:threadId/artifacts`
 * 真实 Postgres 支撑（`apps/api/src/application/chat/list-thread-artifacts.ts` /
 * `land-as-artifact.ts`），此前从未被 `apps/web` 调用过。
 */
export type ListThreadArtifactsOut = z.infer<typeof chat.operations.listThreadArtifacts.out>;
export type LandAsArtifactOut = z.infer<typeof chat.operations.landAsArtifact.out>;
/** `threadId` 由入参单独给（要拼进路径 + body 都要，控制器与契约要求一致），其余字段透传。 */
export type LandAsArtifactInput = Omit<z.input<typeof chat.operations.landAsArtifact.in>, "threadId">;

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

/**
 * 🔴 #594：`projectId: string | null`。`null` = 个人线程——查询参数**整个省略**，
 * 不传字符串 `"null"`。控制器 `chat.controller.ts` 的 `thread()` 把缺省的
 * `@Query("projectId")`（此时是 `undefined`）折成 `null` 再走个人分支；
 * 传字符串 `"null"` 会被当成一个真实但无效的 projectId，得到的是完全不同的错误。
 */
export async function getThread(
  threadId: string,
  projectId: string | null,
  sessionToken?: string,
): Promise<GetThreadOut> {
  return apiRequest<GetThreadOut>(
    chat.operations.getThread.path.replace(":threadId", encodeURIComponent(threadId)),
    { method: "GET", query: { projectId: projectId ?? undefined }, sessionToken },
  );
}

/**
 * 🔴 #594 —— 个人线程（无项目）列表。对应新契约操作 `listPersonalThreads`
 * （`GET /chat/threads`，path 上没有 `:projectId` 段）。
 */
export async function listPersonalThreads(
  opts: { includeArchived?: boolean } = {},
  sessionToken?: string,
): Promise<ListThreadsOut> {
  return apiRequest<ListThreadsOut>(chat.operations.listPersonalThreads.path, {
    method: "GET",
    query: {
      includeArchived: opts.includeArchived === undefined ? undefined : String(opts.includeArchived),
    },
    sessionToken,
  });
}

/**
 * 🔴 #594 —— 建一条个人线程（`projectId: null`）。走同一个 `mutateThread` 端口，
 * 只是 `projectId`/`groupId` 恒为 `null`——个人线程没有组的概念，见后端
 * `mutate-thread.ts` 的 `createPersonalThread` 头注。默认可见范围复用 `private`
 * （仅创建者可读，与个人线程的定义逐字相同）。
 */
export async function createPersonalThread(title: string | null): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "create",
      projectId: null,
      threadId: null,
      groupId: null,
      // ⚠ 契约的 `title` 本就是 `z.string().nullable()`（服务端在 null 时自己起名）。
      //   前端此前把入参类型收窄成 `string`，逼着调用方在客户端编一个默认标题；
      //   现在如实透传 null，交给唯一的事实源决定默认名怎么起。
      title,
      visibilityScope: "private",
      expectedVersion: null,
      reason: null,
    },
  });
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
 * ⚠ **`expectedRosterVersion` 来自读端口**（#513 起）：`getAgentPanel.out.rosterVersion`
 *   （契约 `packages/contracts/src/chat.ts` 的 `getAgentPanel.out`）。它与本端口出参的
 *   `rosterVersion` 是**同一个字段、同一个事实源**（`chat_threads.roster_version`），
 *   🟡 **该契约面待人类补签**——见契约里 `getAgentPanel` 的文件头。
 *
 *   #513 之前只有本端口的**出参**带它，读端口没有 ⇒ 刷新一次页面就无从填起、
 *   跨页面加载的编制变更必然 409（#510 实测撞上，并把现状钉成了 e2e 断言）。
 *
 * ⛔ 调用方**不得**用「读不到就传 0 / -1 / 省略」兜底：乐观锁的意义就是拒绝盲写。
 *   读不到版本号时**不提交**（`components/chat/chat-read-screen.tsx` 的
 *   `runRosterMutation` 就是这么做的）。真并发冲突照契约回 409 `VERSION_CHANGED`，
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

/**
 * 右栏「产物」列表（issue #708）——`GET /chat/threads/:threadId/artifacts`。
 * 草稿仅创建者可见，其余 404（I-36，服务端已过滤，这里不重复判定）。
 */
export async function listThreadArtifacts(
  threadId: string,
  /** `null` = 个人线程（人类裁决，2026-08-21）——不传这个 query 参数，controller
   *  把缺失归一成 `null`，同 `resolveVisibility` 的个人线程分派规则。 */
  projectId: string | null,
  sessionToken?: string,
): Promise<ListThreadArtifactsOut> {
  return apiRequest<ListThreadArtifactsOut>(
    chat.operations.listThreadArtifacts.path.replace(":threadId", encodeURIComponent(threadId)),
    { method: "GET", query: { projectId: projectId ?? undefined }, sessionToken },
  );
}

/**
 * 把一条消息落地为 Artifact（issue #708）——`POST /chat/threads/:threadId/artifacts`。
 * ⚠ 调用方目前**只应该传 `mode: "draft"`**：`live`/`pinned` 要求消息挂有非空
 * citations（I-33），而 citations 的写入路径目前不存在（`get-thread.ts` 的
 * `toMessage()` 恒 `citations: []`），传 `live`/`pinned` 会 100% 命中
 * `MISSING_PROVENANCE_BACKLINK`——这不是本函数的限制，是后端契约现状。
 */
export async function landAsArtifact(
  threadId: string,
  input: LandAsArtifactInput,
  sessionToken?: string,
): Promise<LandAsArtifactOut> {
  return apiRequest<LandAsArtifactOut>(
    chat.operations.landAsArtifact.path.replace(":threadId", encodeURIComponent(threadId)),
    {
      method: "POST",
      body: { threadId, ...input },
      sessionToken,
    },
  );
}

/**
 * 取回一次落地的源 markdown（design-delta chat-persona-roundtrip G1b）——
 * `GET /chat/threads/:threadId/artifacts/:artifactId/source`。图表 modal 重开时用
 * 最新保存版初始化。他人草稿与不存在同一个 404 出口（I-36/I-3，服务端判定）；
 * 存储读不回 503 `STORAGE_UNAVAILABLE`。
 */
export type GetThreadArtifactSourceOut = z.infer<typeof chat.operations.getThreadArtifactSource.out>;

export async function getThreadArtifactSource(
  threadId: string,
  artifactId: string,
  /** `null` = 个人线程——同 `listThreadArtifacts` 同名参数注释。 */
  projectId: string | null,
  sessionToken?: string,
): Promise<GetThreadArtifactSourceOut> {
  return apiRequest<GetThreadArtifactSourceOut>(
    chat.operations.getThreadArtifactSource.path
      .replace(":threadId", encodeURIComponent(threadId))
      .replace(":artifactId", encodeURIComponent(artifactId)),
    { method: "GET", query: { projectId: projectId ?? undefined }, sessionToken },
  );
}

/**
 * 生成用户画像（design-delta chat-persona-roundtrip G2）——
 * `POST /chat/threads/:threadId/persona-summary`。产出以 assistant 消息（mermaid
 * mindmap 围栏）进入线程（`resultMessageId`），同时落一份 draft Artifact。
 * `messageId` 是画像扫描的锚点消息（出处回链），按契约必传。
 */
export type SummarizePersonaOut = z.infer<typeof chat.operations.summarizePersonaFromThread.out>;

export async function summarizePersonaFromThread(
  threadId: string,
  messageId: string,
  sessionToken?: string,
): Promise<SummarizePersonaOut> {
  return apiRequest<SummarizePersonaOut>(
    chat.operations.summarizePersonaFromThread.path.replace(":threadId", encodeURIComponent(threadId)),
    { method: "POST", body: { threadId, messageId }, sessionToken },
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

/** #946 · V9-a：一条附件（契约 `chat-file-upload.Attachment` 的运行时类型）。 */
export type ChatAttachment = z.infer<typeof chatFileUpload.Attachment>;

/** #946 · V9-a：附件容量约束（单文件字节 / 每消息数上限）——前端预检用，服务端仍权威。 */
export const ATTACHMENT_LIMITS = chatFileUpload.ATTACHMENT_LIMITS;

/** #946 · V9-a：允许的 MIME 白名单（前端预检 + accept 属性用）。 */
export const ATTACHMENT_MIME_ALLOWLIST = chatFileUpload.ATTACHMENT_MIME_ALLOWLIST;

/**
 * #946 · V9-a F150/F152：上传一个附件到线程（`POST /chat/threads/:threadId/attachments`）。
 * ⚠ **不套 `apiRequest`**（它假设 JSON body）：字节走 multipart 表单，multer 端点收 `file`
 * 字段。绝不手动设 `Content-Type`——fetch 会从 `FormData` 自带 multipart boundary，手设会
 * 覆盖它导致服务端解析失败。失败信封解析复用 `extractReasonCode` + `ApiError`，与其余端点
 * 一致（`reasonCode` 驱动前端文案：FILE_TOO_LARGE / FILE_TYPE_REJECTED / MIME_MISMATCH /
 * ATTACHMENT_LIMIT_EXCEEDED / NO_WRITE_ROLE / STORAGE_UNAVAILABLE）。
 */
/**
 * 上传单个附件。
 *
 * ⚠ 用 **XMLHttpRequest** 而不是 fetch：只有 XHR 暴露 `upload.onprogress`，才能给出真实上传
 * 进度条（`onProgress` 传 0..1 的已发送比例）。fetch 拿不到上传字节进度，只能不确定态转圈——
 * 人类要求「上传要有进度显示」，故这里换 XHR。错误语义与原 fetch 版一致：非 2xx → `ApiError`
 * 带 `reasonCode`（供 composer 就地报错映射），网络层失败 → `ApiError(0, null)`（默认可重试）。
 */
export async function uploadAttachment(
  threadId: string,
  file: File,
  sessionToken?: string,
  onProgress?: (fraction: number) => void,
): Promise<ChatAttachment> {
  const url = apiUrl(
    chatFileUpload.operations.uploadAttachment.path.replace(":threadId", encodeURIComponent(threadId)),
  );
  const token = sessionToken !== undefined ? sessionToken : getStoredSessionToken();
  const form = new FormData();
  form.append("file", file, file.name);
  return new Promise<ChatAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      const text = xhr.responseText ?? "";
      let json: unknown;
      try { json = text.length > 0 ? JSON.parse(text) : undefined; } catch { json = undefined; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, extractReasonCode(json), json));
        return;
      }
      onProgress?.(1); // 收到 200 = 字节已全部送达并落库
      resolve(json as ChatAttachment);
    };
    xhr.onerror = () => reject(new ApiError(0, null, undefined));
    xhr.send(form);
  });
}

/** 右侧栏「材料」列表（#728 D9）——`GET /chat/threads/:threadId/attachments`（`listThreadAttachments`）。 */
export type ListThreadAttachmentsOut = z.infer<typeof chatFileUpload.operations.listThreadAttachments.out>;

/**
 * 右侧栏「材料」列表（issue #728 D9，人类 2026-08-21 裁决）——已挂到消息上的附件全部行，
 * 按最新在前排列。composer 里还没随消息发出的 pending 附件不在此列（那是草稿态）。
 */
export async function listThreadAttachments(
  threadId: string,
  projectId: string,
  sessionToken?: string,
): Promise<ListThreadAttachmentsOut> {
  return apiRequest<ListThreadAttachmentsOut>(
    chatFileUpload.operations.listThreadAttachments.path.replace(":threadId", encodeURIComponent(threadId)),
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

/**
 * ⚠ `projectId` 是**必传**的（这条纪律不变——#541 的教训是「忘传」而不是「传 null」，
 * 见下），但从 2026-08-14 起**允许显式传 `null`**——本条注释此前一直写着后端
 * `mutateExisting` 会对 `projectId === null` 直接裸 404，那是 #594 之前的旧行为；
 * #594 把 `projectId === null` 从那条恒拒名单里移出了（`mutate-thread.ts` 现在的
 * guard 只剩 `threadId === null || expectedVersion === null`），个人线程的改名/
 * 删除请求本来就该传 `projectId: null`（`resolveVisibility` 自己知道 null 意味着
 * 走个人线程分支），不是缺陷。**本条注释此前描述的 guard 形状已经过时**——写这条
 * 更新是为了不让下一个读者对着一段早就不成立的引用代码去踩坑。
 *
 * #541 的教训仍然成立、仍然是「必传」这条纪律的理由：`create` 传了
 * `input.projectId` 所以一直是通的，`rename` / `delete` 当年**没传、被隐式传成
 * `undefined`**（不是显式 `null`）导致 400——「必传」防的是这种遗漏，不是禁止 `null`
 * 本身；`null` 现在是个合法的、有意义的值（"这是一条个人线程"），不再是历史 bug 的信号。
 */
export async function renameThread(
  threadId: string,
  projectId: string | null,
  title: string,
  expectedVersion: number,
): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "rename",
      projectId,
      threadId,
      groupId: null,
      title,
      visibilityScope: null,
      expectedVersion,
      reason: null,
    },
  });
}

/** `projectId` 必传、允许 `null`，理由同 `renameThread`（见其文档注释）。 */
export async function deleteThread(
  threadId: string,
  projectId: string | null,
  expectedVersion: number,
  reason: string,
): Promise<MutateThreadOut> {
  return apiRequest<MutateThreadOut>(chat.operations.mutateThread.path, {
    method: "POST",
    body: {
      op: "delete",
      projectId,
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

/**
 * 把任意写路径失败翻成用户可读的中文提示（原在 `chat-live-message-panel.tsx`，
 * VZ-fabric 真实保存接线时移到这个叶子模块——`chat-diagram-canvas-modal.tsx` 也要用它，
 * 而它经 `markdown-message.tsx → chat-diagram-fabric.tsx` 被 `chat-live-message-panel.tsx`
 * 引入，若还从那边导出会成循环引用。`lib/live-chat.ts` 不依赖任何组件，两边都能安全引用。
 */
/**
 * 挑「消息应该发给哪个 agent」——2026-08-14 devapp 实测根因：`getAgentPanel`/
 * `listCapabilities` 的 `agents` 都是后端 `ORDER BY name` 排出来的（数据库默认
 * collation 下 Latin 字母排在中文之前），composer 原来直接兜底 `agents?.[0]?.id`，
 * 于是"Deep Research"（Latin 名）总排在"通用助手"（中文名）前面，被意外当成默认
 * agent——不是任何人挑的，只是字母表偶然第一个。Deep Research 是慢速多步的外部服务
 * 调用，意外选中它会让"发一句话"变成长时间卡在"思考中"，看起来像坏了。
 *
 * 纯函数，不做 IO：`requestedAgentId` 命中就用它（用户/调用方明确选过）；否则优先选
 * "通用助手"（`agentDefaults.DEFAULT_AGENT_NAME`，与后端 `ensure-default-agent.ts`
 * 同一单源，不是本文件另抄一份字符串）；组织里真没有这个 agent 时（理论上
 * `ensureDefaultAgent` 保证每个组织都有，但不假设它一定生效）退回原来的「数组第一个」
 * 兜底，不引入新的空态。
 */
export function pickDefaultAgentId(
  agents: GetAgentPanelOut["agents"] | null | undefined,
  requestedAgentId: string,
): string {
  if (agents?.some((agent) => agent.id === requestedAgentId)) return requestedAgentId;
  return agents?.find((agent) => agent.name === agentDefaults.DEFAULT_AGENT_NAME)?.id
    ?? agents?.[0]?.id
    ?? "";
}

/**
 * #1806 —— 2026-08-22 devapp 实测：用 Deep Research 在某条线程发过消息后，切走再切回
 * （或刷新重进），「运行 Agent」选择器又变回硬编码的「通用助手」，与线程真实历史对不上。
 *
 * 根因不是「字段没持久化」——agent 消息本身在 `chat_messages.agent_id` 上确实存了真实
 * agent id，`listMessages` 回读时也投影进了 `DurableMessage.agentId`；前端换线程时只是
 * 把本地选择状态清空（`setAgentId("")`），从没拿这份已经加载到的历史算过默认值。
 *
 * 纯函数：从**当前已加载**的消息窗口里，找 `authorKind === "agent"` 且 `agentId` 非空、
 * `createdAt` 最新的一条，返回它的 agent id。找不到就是空串（调用方据此继续走
 * `pickDefaultAgentId` 原有的「通用助手 → 数组第一个」兜底，不引入新的空态）。
 *
 * 已知边界（沿用 `threadAttachmentOptions` 同一先例）：只看当前已加载窗口，不是全线程
 * 权威查询——足够长的线程如果最近一条 agent 消息还没翻页加载到，这里暂时算不出来，
 * 退到「通用助手」。这是第一版边界，不是 bug。
 */
export function lastUsedAgentId(
  messages: readonly Pick<DurableMessage, "authorKind" | "agentId" | "createdAt">[],
): string {
  let bestId: string | null = null;
  let bestCreatedAt = "";
  for (const m of messages) {
    if (m.authorKind !== "agent" || m.agentId === null) continue;
    if (m.createdAt > bestCreatedAt) {
      bestCreatedAt = m.createdAt;
      bestId = m.agentId;
    }
  }
  return bestId ?? "";
}

export function describeMessageFailure(failure: unknown, action: string): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return `${action}失败：登录已失效（HTTP 401），请重新登录。`;
    if (failure.status === 403) return `${action}失败：当前身份没有写入权限（HTTP 403）。`;
    if (failure.status === 404) {
      // #1534：裸 404 原来一律说成「对话不存在」——对 `mountSkillToThread` 这类
      // 「对话本身没问题、是 skillId 查无此行（或不在可见范围内）」的失败，这句话
      // 指错了地方（实测：人类看到这句去查对话，真根因其实在 skill 那一侧）。
      // `reasonCode` 是服务端唯一权威（`skill-mount.controller.ts` 的 `toHttpError`），
      // 这里按它分岔文案，不新猜一套判据。
      if (failure.reasonCode === "SKILL_NOT_FOUND") {
        return `${action}失败：该 skill 不存在或当前身份不可见（HTTP 404）。`;
      }
      return `${action}失败：对话不存在或当前身份不可见（HTTP 404）。`;
    }
    if (failure.status === 409 && failure.reasonCode === "IDEMPOTENCY_CONFLICT") {
      return `${action}失败：同一 clientMessageId 已对应其他内容（HTTP 409），未创建重复消息。`;
    }
    if (failure.status === 409) return `${action}失败：对话状态冲突或已归档（HTTP 409）。`;
    if (failure.status === 422) return `${action}失败：消息无效或所选 Agent 没有可用的已发布版本（HTTP 422）。`;
    if (failure.status === 503) return `${action}失败：授权或依赖服务暂不可用（HTTP 503），系统没有降级到 mock。`;
    return `${action}失败：${failure.reasonCode ?? "UNKNOWN"}（HTTP ${failure.status}）。`;
  }
  return failure instanceof Error ? `${action}失败：${failure.message}` : `${action}失败，请稍后重试。`;
}
