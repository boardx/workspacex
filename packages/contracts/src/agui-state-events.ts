/**
 * AG-UI 状态轴与自定义事件轴的共享 shape（DA-17，UX-9 Line D2）。
 *
 * 架构裁决（coord-architecture，2026-08-23）：DA-13 双栏的小而频 UI 状态走
 * `STATE_DELTA`（RFC 6902 JSON Patch），DA-15 文件事件走 `CUSTOM {name,value}`，
 * **两轴并用，不 fork 协议**。事件的 wire 字段名逐字取自 `@ag-ui/core@0.0.57`
 * 的 zod schema（`StateSnapshotEventSchema.snapshot` / `StateDeltaEventSchema.delta`
 * / `CustomEventSchema.name+value`），与 ag-ui-protocol/ag-ui 的
 * `docs/concepts/events.mdx` 一致——不凭记忆。
 *
 * ## 这里放什么、不放什么
 *   · `JsonPatchOp` —— RFC 6902 六操作的窄类型，`STATE_DELTA.delta` 的元素类型。
 *     协议侧 `delta` 是 `z.array(z.any())`；本仓收窄到六操作是为了让生产者在
 *     编译期就发不出非法 patch，不是改协议。
 *   · `AguiTodosSnapshot` + `parseWriteTodosSnapshot` —— `write_todos` 工具参数
 *     （`toolArgsSummary`）→ `STATE_SNAPSHOT { snapshot: { todos } }` 的**唯一**
 *     解析纪律。它逐条复刻 `apps/web/components/chat/agent-plan-panel.tsx` 的
 *     `derivePlanTodos`：坏 JSON → null；`todos` 非数组或空 → null；任一条目
 *     `content` 非非空字符串或 `status` 不在三态枚举 → 整体 null。**解析失败不发
 *     事件，绝不发编造的**（本仓反空转纪律）。web 侧收敛到本文件是 D1 线的活
 *     （本轮 apps/web 禁区），在此之前本文件即是新增消费方的单一事实源。
 */
import { z } from "zod";

/** RFC 6902 §4 的六种操作。`STATE_DELTA.delta` 的元素类型。 */
export type JsonPatchOp =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown }
  | { readonly op: "move"; readonly from: string; readonly path: string }
  | { readonly op: "copy"; readonly from: string; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: unknown };

/** 与 `derivePlanTodos` 的 `VALID_STATUS` 逐字一致的三态。 */
export const AguiPlanTodoStatus = z.enum(["pending", "in_progress", "completed"]);
export type AguiPlanTodoStatus = z.infer<typeof AguiPlanTodoStatus>;

export const AguiPlanTodo = z.object({
  content: z.string().refine((s) => s.trim() !== "", "content 不得为空白"),
  status: AguiPlanTodoStatus,
});
export type AguiPlanTodo = z.infer<typeof AguiPlanTodo>;

/** `STATE_SNAPSHOT.snapshot` 的当前唯一生产形状：`{ todos: [...] }`，非空。 */
export const AguiTodosSnapshot = z.object({
  todos: z.array(AguiPlanTodo).min(1),
});
export type AguiTodosSnapshot = z.infer<typeof AguiTodosSnapshot>;

/**
 * `write_todos` 的 `toolArgsSummary` → 快照，失败返回 `null`（调用方不发事件）。
 *
 * `toolArgsSummary` 对 write_todos 有 4000 字符截断特判（deep-agent-model-provider
 * 的 DA-06 注释）——超长参数会被截成非法 JSON，这正是「坏 JSON → null」在生产上
 * 真实存在的路径，不是假想防御。
 */
export function parseWriteTodosSnapshot(toolArgsSummary: string): AguiTodosSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArgsSummary);
  } catch {
    return null;
  }
  const result = AguiTodosSnapshot.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * DA-15 —— 文件事件命名空间扩展（AG-UI `CUSTOM {name,value}` 通道）。
 *
 * ## 边界（backlog 原文）：不 fork AG-UI 协议
 *   标准事件族（`TEXT_MESSAGE_*`/`TOOL_CALL_*`/`STATE_*`）语义不动。三个文件事件走
 *   `CustomEventSchema` 的 `name`/`value` 两个字段——与 DA-17 落的 `STATE_DELTA` 是
 *   同一条 `CUSTOM` 通道上的第二类载荷，不是第二套 wire 类型（复用
 *   `copilotkit-agui.controller.ts` 已有的 `EventType.CUSTOM` 分支，见该文件
 *   `AguiEvent` 联合类型最后一支）。
 *
 * ## 文件标识：复用 DA-12 的 VFS URI，不另造一套
 *   `apps/api/src/domain/vfs/vfs-uri.ts`（DA-12）已经把「一个虚拟文件对象」寻址成
 *   `vfs://<domain>/<id>`。三个事件的 payload 都以这个 URI 为主键，不重新发明
 *   attachment/artifact 各自的 id 形状。**层次约束**：`packages/contracts` 是
 *   `apps/api` 的下游依赖对象（后者 import 前者，不能反过来），所以这里不能直接
 *   `import` `vfs-uri.ts`；`AGUI_FILE_DOMAINS` 和 `VFS_URI_PATTERN` 是该文件
 *   `VFS_DOMAINS`/`ID_PATTERN`/`parseVfsUri` 正则的**逐字镜像**，仅用于 wire-shape
 *   校验（"这个字符串长得像不像一个 vfs URI"），不重复它的判权/查库逻辑——权威解析
 *   永远是 `parseVfsUri`。若 `VFS_DOMAINS` 改了枚举值，这里必须同步改（两处声明，
 *   靠本文件顶部这条注释 + `agui-file-event-contract.test.ts` 里的显式清单对照，
 *   机械收敛，不是本轮能做到单源的——单源需要把 `vfs-uri.ts` 下沉到
 *   `packages/contracts`，不在本 feature 范围内）。
 *
 * ## 目前没有真实生产者——如实登记，不伪造
 *   DA-13（双栏 UI 状态消费）、DA-16（文件事件的真实生产 + 消费端）都还没做。
 *   本文件只落三个事件的**契约形状**（wire 类型 + zod 校验 + 解析纪律），供 DA-16
 *   接入时消费。**不要**为了让这份契约"看起来已经用上了"而在任何 controller 里
 *   造一个假的 `write({ type: CUSTOM, name: "file_created", ... })` 调用点——
 *   本仓反空转纪律（同上，`AguiEvent` 联合类型里 STATE_DELTA/CUSTOM 的先例）。
 *
 * ## 三个事件为什么形状不同
 *   · `file_created`——一次性事实（"这个文件存在了"），字段抄 DA-12 `VfsNode` 的
 *     展示层字段（`name`/`mime`/`bytes`），加一个 `source` 说明这份文件是从本仓
 *     哪条已知写路径产生的（`vfs-uri.ts` 文件头盘点的三条写路径之一在 wire 上的
 *     反映，不是新枚举）。
 *   · `file_content_delta`——复用 `TEXT_MESSAGE_CONTENT` 的"这次追加了什么"模型，
 *     不是 `STATE_DELTA` 的 RFC 6902：JSON Patch 是为**结构化 JSON 文档**设计的
 *     （`path` 寻址 JSON 树节点），文件内容是任意文本/字节流，套 JSON Patch 上去
 *     没有真实语义（"给一段纯文本的第 N 个字符 replace"不是 RFC 6902 的设计场景）。
 *     一个单调递增的 `sequence` 足够客户端按序拼接，同 `TEXT_MESSAGE_CONTENT` 没有
 *     显式序号却靠到达顺序累加的做法一致（这里显式化是因为文件流可能比对话消息流
 *     活得更久、更容易被打断重连，显式序号让客户端能检测丢失/乱序）。
 *   · `file_patch_applied`——DA-16 会用到的"对已有文件做局部修改"。同样不套
 *     RFC 6902：真实的文件补丁工具链（`git apply`/`patch`，以及 agent 沙箱产出
 *     补丁的天然形式）产出的是 unified diff 文本，不是 JSON Patch 操作序列，让
 *     生产端（DA-16）搬运已有格式而不是现造一套结构化 patch 表示。
 */

/** `vfs-uri.ts` 的 `VFS_DOMAINS` 镜像——见上方文件头注释的"两处声明"说明。 */
export const AGUI_FILE_DOMAINS = ["attachment", "artifact"] as const;
export type AguiFileDomain = (typeof AGUI_FILE_DOMAINS)[number];

/** `vfs-uri.ts` 的 `SCHEME`/`ID_PATTERN` 镜像，wire-shape 校验专用。 */
const VFS_URI_PATTERN = /^vfs:\/\/(attachment|artifact)\/[A-Za-z0-9_-]+$/;

/**
 * issue #2321 round 4 —— 反方向：`ActiveFilePanel`（`apps/web/components/chat/
 * active-file-panel.tsx`）收到一个 `source: "agent_run_output"` 的 `file_created`
 * 事件后，要把 `uri` 还原回 `chat_message_attachments.id` 才能拼下载路由
 * （`GET /chat/threads/:threadId/attachments/:attachmentId/content`，与
 * `chat-attachment-preview-modal.tsx` 同一条路由，不新造）。用同一条
 * `VFS_URI_PATTERN` 解析，不是第三份正则——`domain`/`id` 与 `parseVfsUri`（权威，
 * `apps/api` 侧）逐字同构；这里只做 wire-shape 拆分，不做判权/查库。
 */
export function parseVfsUriString(uri: string): { readonly domain: AguiFileDomain; readonly id: string } | null {
  const match = VFS_URI_PATTERN.exec(uri);
  if (match === null) return null;
  const domain = match[1];
  if (domain !== "attachment" && domain !== "artifact") return null;
  return { domain, id: uri.slice(`vfs://${domain}/`.length) };
}

const VfsUriString = z.string().refine(
  (s) => VFS_URI_PATTERN.test(s),
  { message: "must be a vfs://<attachment|artifact>/<id> URI" },
);

/** 三个事件在 `CustomEventSchema.name` 上取的字面量，`CUSTOM` 事件的 `name` 字段值。 */
export const AGUI_FILE_EVENT_NAME = {
  FILE_CREATED: "file_created",
  FILE_CONTENT_DELTA: "file_content_delta",
  FILE_PATCH_APPLIED: "file_patch_applied",
} as const;
export type AguiFileEventName = (typeof AGUI_FILE_EVENT_NAME)[keyof typeof AGUI_FILE_EVENT_NAME];

/**
 * `file_created` 的产生来源——`vfs-uri.ts` 文件头盘点的三条既有写路径在 wire 上的
 * 反映：对话侧直传（`uploadAttachment`）、agent 沙箱产出经写回落地为 attachment
 * （`agent_runs.model_output_files` → `chat_message_attachments`，同一文件头注释
 * 第三条）、业务域物化产出定版（`pin-version.ts` → `artifacts`/`artifact_versions`）。
 * 不是新枚举，是给已知写路径起个 wire 上能读的名字。
 */
export const AguiFileSource = z.enum(["chat_upload", "agent_run_output", "artifact_pin"]);
export type AguiFileSource = z.infer<typeof AguiFileSource>;

export const AguiFileCreatedValue = z.object({
  uri: VfsUriString,
  domain: z.enum(AGUI_FILE_DOMAINS),
  /** 展示名——`VfsNode.name` 同款字段：附件是文件名，产物是落地标题。 */
  name: z.string().refine((s) => s.trim() !== "", "name 不得为空白"),
  mime: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  source: AguiFileSource,
  /**
   * 2026-08-30——这个文件属于哪一条 `chat_messages` 行（真实主键，不是流式聚合用的
   * 临时视图 id）。产生端（`agui-file-events.ts` 的 `buildFileCreatedEvents`）本来就
   * 是拿 `resultMessageId` 去过滤 `chat_message_attachments` 才筛出这些条目的——加这
   * 个字段只是把产生端已经掌握的事实带到 wire 上，不是新计算。有了它，前端才能把
   * `source: "agent_run_output"` 的下载入口挂在**产出它的那条消息**下面（人类裁决：
   * 不再单独占一个中间列，见 `copilotkit-v2-panel.tsx` 的 `ProducedFilesCtx`），而不是
   * 只能按到达顺序猜"最新一条大概率是它"。
   */
  messageId: z.string(),
});
export type AguiFileCreatedValue = z.infer<typeof AguiFileCreatedValue>;

export const AguiFileContentDeltaValue = z.object({
  uri: VfsUriString,
  /** 本次追加的内容片段——语义同 `TEXT_MESSAGE_CONTENT.delta`，累加得到完整内容。 */
  delta: z.string(),
  /** 同一 `uri` 内单调递增、从 0 起的序号；客户端靠它检测丢失/乱序重连。 */
  sequence: z.number().int().nonnegative(),
});
export type AguiFileContentDeltaValue = z.infer<typeof AguiFileContentDeltaValue>;

export const AguiFilePatchAppliedValue = z.object({
  uri: VfsUriString,
  /** unified diff 文本（`git apply`/`patch` 可消费的格式）——不是 RFC 6902 JSON
   *  Patch，见文件头"三个事件为什么形状不同"。 */
  patch: z.string().refine((s) => s.trim() !== "", "patch 不得为空白"),
  /** 人类可读的变更摘要，产生端拿不到时如实置 null，不编造。 */
  summary: z.string().nullable(),
});
export type AguiFilePatchAppliedValue = z.infer<typeof AguiFilePatchAppliedValue>;

/**
 * `value` 的运行期校验入口，同 `parseWriteTodosSnapshot` 一样的解析纪律：
 * 校验失败返回 `null`，调用方不发事件——不发编造/半成形的文件事件。
 */
export function parseAguiFileCreatedValue(value: unknown): AguiFileCreatedValue | null {
  const result = AguiFileCreatedValue.safeParse(value);
  return result.success ? result.data : null;
}

export function parseAguiFileContentDeltaValue(value: unknown): AguiFileContentDeltaValue | null {
  const result = AguiFileContentDeltaValue.safeParse(value);
  return result.success ? result.data : null;
}

export function parseAguiFilePatchAppliedValue(value: unknown): AguiFilePatchAppliedValue | null {
  const result = AguiFilePatchAppliedValue.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * CK-P3（issue #2054）—— **流式 assistant 消息 id → 真实落库 `chat_messages.id` 的回显**。
 *
 * ## 为什么需要它（取证结论，不是设计偏好）
 *
 * `copilotkit-agui.controller.ts` 里 wire 上的 `TEXT_MESSAGE_START.messageId` 是该
 * 请求开始时 `randomUUID()` 出来的**临时 id**——它必须在第一个 delta 之前就存在，
 * 而那时 assistant 消息还没写进 `chat_messages`（写回发生在 run 跑完之后）。真实主键
 * 由 `agui-bridge.ts` 的 `AguiBridgeOutcome.messageId` 携带，此前**从不上 wire**。
 *
 * 后果是任何「按 messageId 找那条落库消息」的能力都接不上去：`rateMessage`
 * （`submit-message-rating.ts`：`findMessageLocation` 查不到 → 404）、`landAsArtifact`
 * （同一道 `findMessageLocation` 门）。前端只能要么不做，要么做一个点下去必然 404 的
 * 假按钮——本仓一贯反对后者。
 *
 * ## 为什么是「事后回显」而不是「事前对齐」
 *
 * 「让流式 id 一开始就等于落库 id」要求在第一个 token 之前就把 assistant 行插进
 * `chat_messages`，也就是**先落一条空消息再补内容**——那会让 `listMessages` 在 run
 * 中途返回一条内容为空的 AI 消息（历史里凭空多出空气泡），并且 run 失败时留下垃圾行。
 * 事后回显不动写回时序：临时 id 照常用于流式聚合，真实 id 在它真的存在之后才广播。
 *
 * ## 通道复用，不新发明
 *
 * 与已有的 `CUSTOM {name:"chat_thread_id"}` 回显（DA-19g）同一条 `onCustomEvent` 通道、
 * 同一套「`value` 在协议层是 `unknown`，前端用本文件导出的 zod schema 原地再校验一次」
 * 的解析纪律。解析失败 → 丢弃这一帧，前端就当没拿到真实 id（于是不画依赖它的按钮），
 * 不退化成「拿临时 id 顶上」。
 */
export const AGUI_CHAT_MESSAGE_ID_EVENT_NAME = "chat_message_id" as const;

export const AguiChatMessageIdValue = z.object({
  /** 本轮 wire 上 `TEXT_MESSAGE_START`/`_CONTENT`/`_END` 用的那个临时 id。 */
  streamingMessageId: z.string().min(1),
  /** 同一条 assistant 消息在 `chat_messages` 里的真实主键。 */
  chatMessageId: z.string().min(1),
});
export type AguiChatMessageIdValue = z.infer<typeof AguiChatMessageIdValue>;

export function parseAguiChatMessageIdValue(value: unknown): AguiChatMessageIdValue | null {
  const result = AguiChatMessageIdValue.safeParse(value);
  return result.success ? result.data : null;
}
