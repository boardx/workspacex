"use client";

/**
 * #946 · V9-a F152 —— 活路由 composer 的附件能力（📎 / 拖拽落区 / 预览条 / 上传态 /
 * 就地报错 / 移除二次确认）。**接真实端点**，不是原型 mock：
 *   · 选/拖文件 → `uploadAttachment`（multipart，POST /chat/threads/:id/attachments）
 *   · 发送时把已上传附件的 serverId 作为 `attachmentIds` 交给 `createMessage`
 *
 * 视觉沿用签核原型（`chat-file-upload-preview.tsx`）；签核数值来自契约单源（经 live-chat
 * 再导出），展示助手来自 `chat-attachment-format`（与原型同一份）。
 *
 * ⚠ 上传进度：fetch 不暴露上传字节进度，故上传态用**不确定态 spinner**（不伪造百分比）。
 */
import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle, File as FileIcon, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip,
  Plus, Presentation, RotateCw, Trash2, UploadCloud, X, type LucideIcon,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  ATTACHMENT_LIMITS, ATTACHMENT_MIME_ALLOWLIST, uploadAttachment, type ChatAttachment,
} from "@/lib/live-chat";
import {
  formatBytes, iconKindForMime, WHITELIST_LABELS, type AttachmentIconKind,
} from "@/lib/chat-attachment-format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/files/overlay";
import { ChatAttachmentPreviewModal } from "./chat-attachment-preview-modal";

const MAX_FILE_BYTES = ATTACHMENT_LIMITS.maxBytesPerFile;
const MAX_ATTACHMENTS = ATTACHMENT_LIMITS.maxAttachmentsPerMessage;
const WHITELIST = new Set<string>(ATTACHMENT_MIME_ALLOWLIST as readonly string[]);

const TYPE_ICON: Record<AttachmentIconKind, LucideIcon> = {
  pdf: FileText, doc: FileText, sheet: FileSpreadsheet, slides: Presentation,
  image: FileImage, text: FileText, file: FileIcon,
};

/** composer 里一个附件的活态。`serverId` 在上传成功后填，是发送时交给 createMessage 的 id。 */
export interface LiveAttachment {
  readonly localId: string;
  readonly filename: string;
  readonly mime: string;
  readonly bytes: number;
  readonly status: "uploading" | "uploaded" | "error";
  readonly serverId?: string;
  readonly error?: string;
  readonly retryable?: boolean;
  /** 上传已发送比例 0..1（XHR upload.onprogress）。用于真实进度条。 */
  readonly progress?: number;
  /** 保留原 File 供重试。 */
  readonly file?: File;
}

export interface BannerState {
  readonly kind: "oversize" | "type" | "count";
  readonly text: string;
}

/**
 * issue #3347 —— 「材料」面板（右栏页签）需要的**最小**上传能力面。
 *
 * 刻意不是整个 `ChatAttachmentsController`：v2 工作台里控制器活在
 * `CopilotKitV2Panel` 内部，而「材料」页签是外壳的兄弟节点（`ChatTaskInspector`），
 * 中间要跨一层桥。桥上只搬这三样——`pickFiles` 是 `useCallback` 稳定身份、`banner`
 * 只在被拒时变、`disabled` 跟随写权限，都不会随上传进度高频抖动（`attachments`
 * 会，所以**不**搬它）。
 *
 * ⚠ 这不是第二套上传逻辑：`pickFiles` 就是 composer 那一个控制器的同一个函数，
 * 拖进右栏的文件和点 📎 选的文件进的是**同一条 pending 队列**、同一次
 * `POST /chat/threads/:id/attachments`、同一批 `attachmentIds` 随下一条消息发出。
 * `ChatAttachmentsController` 结构上满足本接口，旧轨道（`chat-read-screen` /
 * `personal-chat-screen`）继续直接把控制器本体传进来，无需改。
 */
export interface ChatMaterialsUploadPort {
  readonly pickFiles: (files: FileList | File[] | null) => void;
  readonly banner: BannerState | null;
}

/** ApiError.reasonCode → 就地报错文案 + 是否可重试。 */
function describeUploadError(err: unknown): { text: string; retryable: boolean } {
  if (err instanceof ApiError) {
    switch (err.reasonCode) {
      case "FILE_TOO_LARGE": return { text: `超过单文件 ${formatBytes(MAX_FILE_BYTES)} 上限`, retryable: false };
      case "FILE_TYPE_REJECTED": return { text: `不支持的文件类型（支持：${WHITELIST_LABELS}）`, retryable: false };
      case "MIME_MISMATCH": return { text: "文件内容与其类型不符，未添加", retryable: false };
      case "ATTACHMENT_LIMIT_EXCEEDED": return { text: `每条消息最多 ${MAX_ATTACHMENTS} 个附件`, retryable: false };
      case "NO_WRITE_ROLE": return { text: "你没有在此对话上传附件的权限", retryable: false };
      case "STORAGE_UNAVAILABLE": return { text: "存储暂不可用，请重试", retryable: true };
      default: break;
    }
  }
  return { text: "上传失败，请重试", retryable: true };
}

let localSeq = 0;
function nextLocalId(): string {
  localSeq += 1;
  return `att-${localSeq}-${globalThis.crypto?.randomUUID?.() ?? String(localSeq)}`;
}

/**
 * 文件落区（drag & drop）的**唯一**实现。composer 的全屏落区与 issue #3347 右栏
 * 「材料」落区都用它——两处落区、一份进出判定，不许各写一遍。
 *
 * #1492 的计数器语义原样保留：dragEnter/dragLeave 在大面积容器上，鼠标每跨一层子
 * 元素边界都会各触发一次 leave+enter，只用 over/leave 判进出会在边界上闪烁。每次
 * enter +1、leave −1，归零才算真的离开——同层级的 enter/leave 成对出现，跨子元素的
 * 中间态相互抵消。
 *
 * `onNonFile`：**拖进来的不是文件**（纯文本 / 链接 / 文件夹）时的回调。浏览器对这三
 * 种情况给的 `dataTransfer.files` 都是空的（文件夹在多数浏览器里进不了 `files`），
 * 不给这个回调就等于"用户松了手、系统一声不吭"——本仓刚修过一批这种（#3311 / #3317）。
 * composer 那侧不传（保持既有行为，它另有全屏遮罩在说话），右栏落区必须传。
 */
export function useFileDropSurface(opts: {
  onFiles: (files: FileList) => void;
  onNonFile?: () => void;
  enabled?: boolean;
}): { dragActive: boolean; dragHandlers: {
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
} } {
  const { onFiles, onNonFile, enabled = true } = opts;
  const [dragActive, setDragActive] = React.useState(false);
  const dragCounter = React.useRef(0);
  const enabledRef = React.useRef(enabled); enabledRef.current = enabled;
  const onFilesRef = React.useRef(onFiles); onFilesRef.current = onFiles;
  const onNonFileRef = React.useRef(onNonFile); onNonFileRef.current = onNonFile;

  React.useEffect(() => {
    if (!enabled) { dragCounter.current = 0; setDragActive(false); }
  }, [enabled]);

  const dragHandlers = React.useMemo(() => ({
    // dragOver 仍要 preventDefault——浏览器默认不让 drop，这是允许落区生效的必要条件
    // （不用它来切 active，只用来"保持允许 drop"，避免每次 mousemove 都触发 setState）。
    onDragOver: (e: React.DragEvent) => { if (enabledRef.current) e.preventDefault(); },
    onDragEnter: (e: React.DragEvent) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      dragCounter.current += 1;
      setDragActive(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!enabledRef.current) return;
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setDragActive(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!enabledRef.current) return;
      // ⚠ 无条件 preventDefault：不拦的话浏览器会**直接打开拖进来的文件**，把用户
      //   从这条对话里导航走（未发出的草稿、正在跑的一轮全没了）。拖进来的东西
      //   合不合法是下一步的事，"不要把页面弄丢"是先决条件。
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) onFilesRef.current(files);
      else onNonFileRef.current?.();
    },
  }), []);

  return { dragActive, dragHandlers };
}

/**
 * 右栏「材料」页签的拖拽落区遮罩（issue #3347）。数值与白名单来自契约单源，
 * 与 composer 那两个遮罩同一份常量——不在这里复述第二遍。
 */
export function ChatMaterialsDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center border-2 border-dashed border-primary bg-card/90 p-2 text-center backdrop-blur-sm"
      data-testid="chat-materials-dropzone"
    >
      <div className="flex flex-col items-center gap-1.5 text-primary">
        <UploadCloud aria-hidden className="h-7 w-7" />
        <span className="text-12 font-medium">松开上传，加入下一条消息</span>
        <span className="text-10 text-muted-foreground">
          单个不超过 {formatBytes(MAX_FILE_BYTES)} · 最多 {MAX_ATTACHMENTS} 个 · 支持 {WHITELIST_LABELS}
        </span>
      </div>
    </div>
  );
}

/**
 * composer 附件状态机。`threadId` 变（切线程）会清空——一个线程的 pending 附件不该带到另一个。
 */
export function useChatAttachments(opts: {
  canWrite?: boolean;
  threadId: string;
  bearer?: string;
  /**
   * 2026-09-02（issue #2520）—— `threadId` 为空串时的按需解析器：第一次真的有文件要
   * 上传时才调用，拿到真实线程 id 再发上传请求。给 v2 面板的"全新对话"用：此前它在
   * 挂载时就 `createPersonalThread` 预建一条附件专用线程，用户每打开一次裸 `/chat`
   * 列表里就多一条空的「新对话」。不传时行为与从前完全一样（`threadId` 为空就上传失败）。
   */
  resolveThreadId?: () => Promise<string>;
}) {
  const { threadId, bearer, resolveThreadId, canWrite = true } = opts;
  const canWriteRef = React.useRef(canWrite); canWriteRef.current = canWrite;
  const [attachments, setAttachments] = React.useState<LiveAttachment[]>([]);
  /**
   * `pickFiles` 需要"当前有几个附件"来判数量上限，但不能靠把 `attachments` 塞进
   * `useCallback` 依赖数组来读最新值——那会让 `pickFiles` 在每次上传进度更新
   * （`patch` 高频调 `setAttachments`）时都换一个新的函数身份，级联打穿所有吃它当
   * 依赖的下游（拖拽 handlers 等）。改用一个跟 `attachments` 同步的 ref，`pickFiles`
   * 读它而不进依赖数组，函数身份保持稳定，读到的又不是过期值。
   */
  const attachmentsRef = React.useRef<LiveAttachment[]>([]);
  React.useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  const [banner, setBanner] = React.useState<BannerState | null>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const previousThreadIdRef = React.useRef(threadId);
  React.useEffect(() => {
    // 切线程：清空本地附件态（不影响服务端已落的 pending 行，那些随线程/未挂而存在）。
    // ⚠ "还没有线程"（空串）→ 按需解析出真实 id 不是切线程，是同一段对话刚刚有了
    //   id——正在上传/已上传的附件就挂在这条新线程上，不能清。
    const previous = previousThreadIdRef.current;
    previousThreadIdRef.current = threadId;
    if (previous === "" || previous === threadId) return;
    setAttachments([]);
    setBanner(null);
    setConfirmingId(null);
  }, [threadId]);

  const patch = React.useCallback((localId: string, next: Partial<LiveAttachment>) => {
    setAttachments((cur) => cur.map((a) => (a.localId === localId ? { ...a, ...next } : a)));
  }, []);

  const doUpload = React.useCallback(async (localId: string, file: File) => {
    if (!canWriteRef.current) return;
    try {
      const targetThreadId = threadId !== "" ? threadId : await resolveThreadId?.();
      if (!canWriteRef.current) return;
      if (!targetThreadId) throw new Error("no thread to attach to");
      const uploaded: ChatAttachment = await uploadAttachment(
        targetThreadId, file, bearer,
        (fraction) => patch(localId, { progress: fraction }),
      );
      patch(localId, { status: "uploaded", serverId: uploaded.id, bytes: uploaded.bytes, mime: uploaded.mime, progress: 1 });
    } catch (err) {
      const { text, retryable } = describeUploadError(err);
      patch(localId, { status: "error", error: text, retryable });
    }
  }, [threadId, bearer, patch, resolveThreadId]);

  /**
   * 选择/拖入文件：客户端预检（数量/大小/类型，只为快反馈，服务端仍权威）→ 逐个并发上传。
   *
   * ⚠ 2026-08-19 实测修复：这里以前把 `nextLocalId()`（有副作用——自增计数器 +
   * `crypto.randomUUID()`）、`setBanner`、`queueMicrotask` 触发真实上传，全部塞在
   * `setAttachments` 的 updater 函数体里。React 18 StrictMode（开发环境）会刻意把
   * updater 调用两次来抓不纯的 reducer；由于 `nextLocalId()` 本身不纯，两次调用生成
   * **两个不同的** localId，各自触发一次真实 `POST .../attachments`——每选一次文件，
   * 真实上传发生两次，产出两个不同的服务端 id，最终"发消息时用哪个"纯属两次网络请求
   * 谁先落地的竞态（#1584 e2e 新断言第一次照到这个角落）。
   * 修法：把全部不纯的部分（id 生成、banner 提示、上传触发）挪到 updater **外面**，
   * `setAttachments` 只传一个纯合并函数——不管 StrictMode 调用它几次，结果都一样，
   * 副作用只在 `pickFiles` 本体（一次真实点击只调一次）里跑一遍。
   */
  const pickFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!canWriteRef.current || !files) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    let running = attachmentsRef.current.length;
    let nextBanner: BannerState | null = null;
    const toUpload: Array<{ localId: string; file: File }> = [];
    const added: LiveAttachment[] = [];
    for (const file of list) {
      if (running >= MAX_ATTACHMENTS) {
        nextBanner = { kind: "count", text: `每条消息最多 ${MAX_ATTACHMENTS} 个附件，已达上限，多出的未添加。` };
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        nextBanner = { kind: "oversize", text: `「${file.name}」超过单文件 ${formatBytes(MAX_FILE_BYTES)} 上限，未添加。` };
        continue;
      }
      if (file.type && !WHITELIST.has(file.type)) {
        nextBanner = { kind: "type", text: `不支持的文件类型「${file.name}」。支持：${WHITELIST_LABELS}。` };
        continue;
      }
      const localId = nextLocalId();
      added.push({
        localId, filename: file.name, mime: file.type || "application/octet-stream",
        bytes: file.size, status: "uploading", progress: 0, file,
      });
      toUpload.push({ localId, file });
      running += 1;
    }

    setBanner(nextBanner);
    if (added.length > 0) setAttachments((cur) => cur.concat(added)); // 纯合并，StrictMode 调几次结果都一样
    // 真实网络请求在此触发，且只在这一条真实调用路径上触发一次（不在任何 setState updater 里）。
    queueMicrotask(() => { for (const u of toUpload) void doUpload(u.localId, u.file); });
  }, [doUpload]);

  const retry = React.useCallback((localId: string) => {
    if (!canWriteRef.current) return;
    // 同 `pickFiles` 那处 2026-08-19 修复的道理：真实上传的触发不能挂在 `setAttachments`
    // 的 updater 函数体里（StrictMode 双调用会真的重传两次）。用 `attachmentsRef` 读现状，
    // updater 只做纯合并，`doUpload` 调用在 updater 外面、只发生一次。
    const target = attachmentsRef.current.find((a) => a.localId === localId);
    if (!target?.file) return;
    setAttachments((cur) => cur.map(
      (a) => (a.localId === localId ? { ...a, status: "uploading", error: undefined, progress: 0 } : a),
    ));
    queueMicrotask(() => void doUpload(localId, target.file!));
  }, [doUpload]);

  const removeAttachment = React.useCallback((localId: string) => {
    setAttachments((cur) => cur.filter((a) => a.localId !== localId));
    setConfirmingId(null);
  }, []);

  const clear = React.useCallback(() => {
    setAttachments([]);
    setBanner(null);
    setConfirmingId(null);
  }, []);

  // #1492 的计数器落区实现已抽成 `useFileDropSurface`（本文件上方），composer 与
  // issue #3347 的右栏「材料」落区共用同一份；这里只是它的一个使用者。
  const { dragActive, dragHandlers } = useFileDropSurface({ onFiles: pickFiles });

  /** 已上传附件的 serverId（发送时作为 attachmentIds）。 */
  const uploadedIds = React.useMemo(
    () => attachments.filter((a) => a.status === "uploaded" && a.serverId).map((a) => a.serverId!),
    [attachments],
  );

  return {
    attachments, banner, dragActive, confirmingId, fileInputRef,
    atLimit: attachments.length >= MAX_ATTACHMENTS,
    hasUploading: attachments.some((a) => a.status === "uploading"),
    uploadedIds,
    dragHandlers,
    pickFiles, retry, removeAttachment, clear,
    askRemove: setConfirmingId,
    cancelRemove: () => setConfirmingId(null),
    openFileDialog: () => fileInputRef.current?.click(),
  };
}

export type ChatAttachmentsController = ReturnType<typeof useChatAttachments>;

/* ── 展示件 ────────────────────────────────────────────────────────────── */

export function ChatAttachmentBanner(
  { banner, testId = "chat-attachment-error" }: { banner: BannerState | null; testId?: string },
) {
  if (!banner) return null;
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-11 text-destructive"
      data-testid={testId}
      data-error-kind={banner.kind}
      role="alert"
    >
      <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{banner.text}</span>
    </div>
  );
}

/** 拖拽高亮落区——覆盖在 composer 上，明确「松手即添加」。 */
export function ChatAttachmentDropzone({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5"
      data-testid="chat-attachment-dropzone"
    >
      <div className="flex flex-col items-center gap-1 text-primary">
        <UploadCloud aria-hidden className="h-6 w-6" />
        <span className="text-12 font-medium">松开即上传到这条消息</span>
        <span className="text-10 text-muted-foreground">
          单个不超过 {formatBytes(MAX_FILE_BYTES)} · 最多 {MAX_ATTACHMENTS} 个 · 支持 {WHITELIST_LABELS}
        </span>
      </div>
    </div>
  );
}

/**
 * #1492 —— chat 主界面（消息列表 + composer 整个可视区）拖文件时的全屏悬浮层，
 * 对标 Codex：不再局限于 composer 那个小盒子，是「文件上传按钮」的简化/加速版本，
 * 不新增上传机制——松手仍走 `pickFiles`，文件仍落在 composer 下方的附件列表。
 * `pointer-events-none`：悬浮层只是视觉提示，真正接住 dragOver/dragLeave/drop 的
 * 是挂了 `dragHandlers` 的父容器，盖在上面的这层不能挡住那些事件继续冒泡。
 */
export function ChatFullSurfaceDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-card/90 backdrop-blur-sm"
      data-testid="chat-fullsurface-drop-overlay"
    >
      <div className="flex flex-col items-center gap-2 text-primary">
        <UploadCloud aria-hidden className="h-8 w-8" />
        <span className="text-14 font-medium">松开上传文件到这条消息</span>
        <span className="text-11 text-muted-foreground">
          单个不超过 {formatBytes(MAX_FILE_BYTES)} · 最多 {MAX_ATTACHMENTS} 个 · 支持 {WHITELIST_LABELS}
        </span>
      </div>
    </div>
  );
}

export function ChatAttachmentList({
  ctl, disabled, canRetry = true, testId = "chat-attachment-list", idPrefix = "chat-attachment",
}: {
  ctl: ChatAttachmentsController; disabled?: boolean; canRetry?: boolean; testId?: string; idPrefix?: string;
}) {
  if (ctl.attachments.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 px-1 pb-1.5 pt-1" data-testid={testId}>
      {ctl.attachments.map((att) => (
        <AttachmentRow
          key={att.localId}
          att={canRetry ? att : { ...att, retryable: false }}
          idPrefix={idPrefix}
          disabled={disabled}
          confirming={ctl.confirmingId === att.localId}
          onAskRemove={() => ctl.askRemove(att.localId)}
          onCancelRemove={ctl.cancelRemove}
          onConfirmRemove={() => ctl.removeAttachment(att.localId)}
          onRetry={() => ctl.retry(att.localId)}
        />
      ))}
    </ul>
  );
}

/**
 * 📎 按钮 + 隐藏文件输入 + 计数。放在 composer 底部控件行左侧。
 *
 * 点 📎 **先弹「加材料进这一轮」面板**（`ChatAttachMaterialModal`），不再直接开系统文件框——
 * 由面板里的「从本机文件选择」才触发隐藏 input。拖拽落区行为不变（仍在 composer 上）。
 * 隐藏 input 留在这里渲染，供面板经 `ctl.openFileDialog` 复用。
 */
/**
 * 2026-09-02（composer 三层结构）—— 附件能力的"无按钮"落点：隐藏文件输入 + 「加材料」
 * 面板。触发入口由调用方自己渲染（v2 composer 里是「+」菜单的一项，testid
 * `chat-attachment-input` 跟着搬过去），`open`/`onClose` 受控。`ChatAttachmentButton`
 * （旧轨道 composer 仍在用）内部也用它，隐藏 input 与 Modal 只有这一份实现。
 */
export function ChatAttachmentDock({
  ctl, open, disabled, onClose,
}: { ctl: ChatAttachmentsController; open: boolean; disabled?: boolean; onClose: () => void }) {
  return (
    <>
      <input
        ref={ctl.fileInputRef}
        type="file"
        multiple
        accept={(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).join(",")}
        className="hidden"
        data-testid="chat-attachment-file-input"
        onChange={(e) => { ctl.pickFiles(e.target.files); e.target.value = ""; }}
      />
      <ChatAttachMaterialModal ctl={ctl} open={open} disabled={disabled} onClose={onClose} />
    </>
  );
}

export function ChatAttachmentButton({
  ctl, disabled, showLabel = false,
}: {
  ctl: ChatAttachmentsController;
  disabled?: boolean;
  /**
   * 2026-08-29 Claude Design 重设计稿——composer 里的这颗按钮是带"材料"二字的
   * 胶囊，不是纯图标。默认 `false`：其余调用方（若有）与既有截图/快照不受影响，
   * 只有显式要这份视觉的调用方才看得到文字。
   */
  showLabel?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // 线程归档 / 提交中途 → 关面板，避免停在一个不能操作的壳上。
  React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size={showLabel ? "xs" : "icon"}
        variant="outline"
        // issue #2130 —— 命名胶囊圆角 token（`tailwind.config.ts` 的
        // `borderRadius.pill`），composer 胶囊类控件本轮统一迁移。
        className={showLabel ? "gap-1 rounded-pill" : "rounded-pill"}
        data-testid="chat-attachment-input"
        aria-label="添加附件"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`添加附件（单个不超过 ${formatBytes(MAX_FILE_BYTES)}，最多 ${MAX_ATTACHMENTS} 个）`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Paperclip aria-hidden className="h-3.5 w-3.5" />
        {showLabel ? <span>材料</span> : null}
      </Button>
      {ctl.attachments.length > 0 ? (
        <span
          className={`text-10 ${ctl.atLimit ? "text-warning" : "text-muted-foreground"}`}
          data-testid="chat-attachment-count"
        >
          {ctl.attachments.length}/{MAX_ATTACHMENTS}
        </span>
      ) : null}
      <ChatAttachmentDock ctl={ctl} open={open} disabled={disabled} onClose={() => setOpen(false)} />
    </div>
  );
}

/**
 * 「加材料进这一轮」面板 —— **第一版从简**（人类 2026-08-11 裁决，coord-main 转达）。
 *
 * 复用 `files/overlay` 的 `Modal` 壳（不另造）。只做已落地的上传：拖拽/选择 → 25MB+白名单校验 →
 * 真实上传（带进度条），面板列出全部已传文件，全部随消息进上下文（文件**内容**进模型等 W1/F153
 * anydoc 落地）。**砍掉且不留占位**：token 计数 / 逐文件勾选进上下文 / 机密→本地模型路由——不做假开关。
 *
 * 选/拖即上传，文件同时落在 composer 的 pending 预览条上。「取消」「加入这一轮」都只关面板；
 * 上传未完时「加入这一轮」禁用，与发送键同一诚实约束。
 */
export function ChatAttachMaterialModal({
  ctl, open, disabled, onClose,
}: { ctl: ChatAttachmentsController; open: boolean; disabled?: boolean; onClose: () => void }) {
  // Modal 壳是 `absolute inset-0`（贴最近定位祖先）。composer 输入框那层是 `relative`，直接挂会被
  // 困在输入框小盒里。portal 到 body 的 `fixed inset-0` 宿主，才能像 files 页那样铺满视口。
  // mounted 门：SSR 与 client 首帧都渲 null（避免 portal 造成 hydration 不匹配），挂载后再出 portal。
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;
  const count = ctl.attachments.length;
  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="chat-attach-material-portal">
    <Modal
      testid="chat-attach-material"
      title="加材料进这一轮"
      subtitle={`上传的文件都会随这条消息进上下文；单个不超过 ${formatBytes(MAX_FILE_BYTES)}，最多 ${MAX_ATTACHMENTS} 个。`}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button" size="sm" variant="ghost"
            data-testid="chat-attach-material-cancel" onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button" size="sm" variant="primary"
            data-testid="chat-attach-material-confirm"
            disabled={ctl.hasUploading}
            onClick={onClose}
          >
            加入这一轮
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" {...ctl.dragHandlers}>
        {/* 拖拽落区 + 从本机选择 */}
        <div
          className={`grid place-items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
            ctl.dragActive ? "border-primary bg-primary/5" : "border-border"
          }`}
          data-testid="chat-attach-material-dropzone"
        >
          <UploadCloud aria-hidden className="h-6 w-6 text-muted-foreground" />
          <p className="text-12 font-medium">把文件拖进来</p>
          <p className="text-10 text-muted-foreground">
            单个不超过 {formatBytes(MAX_FILE_BYTES)} · 最多 {MAX_ATTACHMENTS} 个 · 支持 {WHITELIST_LABELS}
          </p>
          <Button
            type="button" size="sm" variant="outline" className="mt-1 rounded-full"
            data-testid="chat-attach-material-pick"
            disabled={disabled || ctl.atLimit}
            onClick={ctl.openFileDialog}
          >
            从本机文件选择
          </Button>
          {ctl.atLimit ? <p className="text-10 text-warning">已达 {MAX_ATTACHMENTS} 个上限，先移除再添加</p> : null}
        </div>

        <ChatAttachmentBanner banner={ctl.banner} />

        <div>
          <p className="px-1 text-11 text-muted-foreground" data-testid="chat-attach-material-selected-count">
            本次已选 · {count}
          </p>
          <ChatAttachmentList
            ctl={ctl}
            disabled={disabled}
            testId="chat-attach-material-list"
            idPrefix="chat-attach-material-att"
          />
        </div>
      </div>
    </Modal>
    </div>,
    document.body,
  );
}

/**
 * issue #1758（人类给参考截图后裁决 C）—— 右栏「材料」区块头部的直传入口。
 *
 * 点了它选出的文件，走的是**同一个** `ctl.pickFiles`（与 composer 的 📎 完全同一条路径、
 * 同一次真实 `uploadAttachment` 调用），效果就是"加进 composer 的 pending 队列"——
 * **不**自动发消息、**不**触发 agent run。上传后文件出现在输入框下方的 composer 附件区
 * （`ChatAttachmentList`），不会立刻出现在"材料"列表里；材料列表的语义仍是"已随某条
 * 消息发出的附件"（`chat-materials-panel.tsx` 头注），用户仍需真正发一条消息才会进材料
 * 列表。这个语义差异是刻意的（人类裁决：自动发消息会让"上传参考文件"这个动作意外触发
 * 一次真实 AI 回合，见 #1758 架构调查——`acceptHumanMessage` 把附件转正与 `kick` 一次
 * 真实 agent run 是同一次调用，没有"只挂附件不触发 AI"的旁路）。
 *
 * 用自己的本地 `<input>`+ref，**不**复用 `ctl.fileInputRef`——那个 ref 已经被 composer
 * 自己的隐藏 input（`ChatAttachmentButton`）占用；两处若共用同一个 ref 对象，后挂载的
 * 一方会覆盖前者的 DOM 节点引用，`ctl.openFileDialog()` 与这里的本地点击各自只能点中
 * 其中一个，是入口互相打架的角落，所以给这个入口另开一个独立 ref。
 */
export function ChatSidebarUploadButton({
  ctl, disabled,
}: { ctl: ChatMaterialsUploadPort; disabled?: boolean }) {
  const localInputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-6 rounded-md"
        data-testid="chat-materials-upload-trigger"
        aria-label="上传文件（加入下一条消息的附件）"
        title={`上传文件，加入下一条消息的附件（单个不超过 ${formatBytes(MAX_FILE_BYTES)}，最多 ${MAX_ATTACHMENTS} 个）；发送后才会出现在材料列表`}
        disabled={disabled}
        onClick={() => localInputRef.current?.click()}
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
      </Button>
      <input
        ref={localInputRef}
        type="file"
        multiple
        accept={(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).join(",")}
        className="hidden"
        data-testid="chat-materials-upload-input"
        onChange={(e) => { ctl.pickFiles(e.target.files); e.target.value = ""; }}
      />
    </span>
  );
}

/**
 * #946 · V9-a F152：消息气泡下的附件展示（listMessages 的 attachments 投影）。
 * 没有移除/重试（那是 composer 可编辑预览条的事）——只有文件名 + 类型图标 + 大小 +
 * #1584 起：点击弹窗预览/下载（`ChatAttachmentPreviewModal`）。
 */
export function MessageAttachments({
  attachments, threadId,
}: { attachments: readonly ChatAttachment[]; threadId: string }) {
  const [previewing, setPreviewing] = React.useState<ChatAttachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul className="mt-1 flex flex-col gap-1" data-testid="chat-message-attachments">
        {attachments.map((att) => {
          const Icon = TYPE_ICON[iconKindForMime(att.mime)];
          return (
            <li key={att.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-panel px-2 py-1 text-left transition-colors duration-fast hover:bg-muted/60 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`chat-message-attachment-${att.id}`}
                onClick={() => setPreviewing(att)}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-11 text-card-foreground" title={att.filename}>{att.filename}</span>
                <span className="ml-auto shrink-0 text-10 text-muted-foreground">{formatBytes(att.bytes)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {previewing ? (
        <ChatAttachmentPreviewModal
          threadId={threadId}
          attachment={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </>
  );
}

function AttachmentRow({
  att, confirming, disabled, idPrefix = "chat-attachment",
  onAskRemove, onCancelRemove, onConfirmRemove, onRetry,
}: {
  att: LiveAttachment;
  confirming: boolean;
  disabled?: boolean;
  idPrefix?: string;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onRetry: () => void;
}) {
  const Icon = TYPE_ICON[iconKindForMime(att.mime)];
  const isError = att.status === "error";
  const isUploading = att.status === "uploading";
  return (
    <li
      className={`relative rounded-lg border bg-panel px-2 py-1.5 transition-colors duration-base ${
        isError ? "border-destructive/40" : "border-border-subtle"
      }`}
      data-testid={`${idPrefix}-chip-${att.localId}`}
      data-status={att.status}
    >
      <div className="flex items-center gap-2">
        <div
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
            isError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          }`}
          aria-hidden
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon aria-hidden className="h-3.5 w-3.5" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-12 font-medium text-card-foreground" title={att.filename}>
            {att.filename}
          </span>
          <div className="flex items-center gap-1.5 text-10 text-muted-foreground">
            <span>{formatBytes(att.bytes)}</span>
            {isUploading ? (
              <span data-testid={`${idPrefix}-progress-label-${att.localId}`}>
                · 上传中 {Math.round((att.progress ?? 0) * 100)}%
              </span>
            ) : null}
            {att.status === "uploaded" ? <Badge tone="outline">已就绪</Badge> : null}
            {isError ? <span className="text-destructive">· {att.error}</span> : null}
          </div>
          {isUploading ? (
            <Progress
              value={Math.round((att.progress ?? 0) * 100)}
              className="mt-1"
              label={`上传进度 ${att.filename}`}
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isError && att.retryable ? (
            <Button
              type="button" size="xs" variant="outline" className="rounded-md"
              data-testid={`${idPrefix}-retry-${att.localId}`}
              disabled={disabled}
              onClick={onRetry}
            >
              <RotateCw aria-hidden className="h-3 w-3" />
              重试
            </Button>
          ) : null}
          <Button
            type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-md"
            data-testid={`${idPrefix}-remove-${att.localId}`}
            aria-label={`移除附件 ${att.filename}`}
            title="移除附件"
            disabled={disabled}
            onClick={onAskRemove}
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {confirming ? (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
          data-testid={`${idPrefix}-remove-confirm-${att.localId}`}
          role="alertdialog"
          aria-label="确认移除附件"
        >
          <span className="flex items-center gap-1.5 text-11 text-card-foreground">
            <Trash2 aria-hidden className="h-3.5 w-3.5 text-destructive" />
            移除「{att.filename}」？它不会随这条消息发送。
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button" size="xs" variant="ghost"
              data-testid={`${idPrefix}-remove-cancel-${att.localId}`}
              onClick={onCancelRemove}
            >
              取消
            </Button>
            <Button
              type="button" size="xs" variant="destructive"
              data-testid={`${idPrefix}-remove-yes-${att.localId}`}
              onClick={onConfirmRemove}
            >
              移除
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ── issue #3373 · composer 内联附件条（Claude Code 式紧凑 chip / 缩略图） ────── */

/**
 * 一个待发附件的**本机** blob URL。
 *
 * 缩略图与放大预览的字节都来自 `att.file`——`pickFiles` 早就把原始 `File` 留着供重试
 * （`LiveAttachment.file`），所以**不需要新端点、也不需要等上传完成**：图片选进来的那一
 * 刻就能显示真实缩略图，上传中/失败时同样看得见自己选了什么。
 *
 * ⚠ 这是**唯一**一处为待发草稿造 object URL 的地方。已发出的附件（`message_id NOT NULL`）
 * 走的是另一条既有路径（`ChatAttachmentPreviewModal` + `useAuthedImageSrc`，带 Bearer 取
 * 服务端字节）——两条路径服务两种不同的事实，不是同一件事声明了两遍。
 *
 * 每个 URL 在 file 变化或组件卸载时 `revokeObjectURL`：不 revoke 的 blob URL 会把整份文件
 * 字节钉在内存里直到整页卸载（25MB × 最多 N 个）。
 */
function useLocalFileUrl(file: File | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => { URL.revokeObjectURL(next); };
  }, [file]);
  return url;
}

/** 待发附件能不能出真实缩略图：得是图片，且原始 `File` 还在手上。 */
function isThumbnailable(att: LiveAttachment): boolean {
  return iconKindForMime(att.mime) === "image" && att.file !== undefined;
}

/**
 * issue #3373 —— 待发草稿的放大预览。
 *
 * 字节用**本机 blob URL**（见 `useLocalFileUrl` 头注），所以上传中/上传失败的图片一样能
 * 放大看——这正是「点了没反应的东西」的反面：只要用户选进来了，点它就一定能看到它。
 *
 * 关闭方式三条都有，且都由 `Modal`（Radix Dialog）本体提供，不在这里另写一份：
 * Esc（`onOpenChange(false)`）、点遮罩（同上）、右上角 `-close` 图标按钮；页脚再给一颗
 * 文字「关闭」按钮（`-dismiss`），与 `ChatAttachmentPreviewModal` 同一套命名约定。
 *
 * `data-preview-local-id` / `alt` 是判据锚点：预览打开的**是哪一张**必须可断言——
 * 「点了第 2 张却打开第 1 张」是这类实现最典型的失效形状，只判「预览容器存在」抓不到它。
 */
export function ChatDraftAttachmentPreview({
  attachment, onClose,
}: { attachment: LiveAttachment; onClose: () => void }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const src = useLocalFileUrl(attachment.file);
  const isImage = iconKindForMime(attachment.mime) === "image";
  const Icon = TYPE_ICON[iconKindForMime(attachment.mime)];
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-40" data-testid="chat-attachment-draft-preview-portal">
      <Modal
        testid="chat-attachment-draft-preview"
        title={attachment.filename}
        subtitle={`${attachment.mime} · ${formatBytes(attachment.bytes)}${
          attachment.status === "uploaded" ? " · 已就绪" : attachment.status === "uploading" ? " · 上传中" : " · 上传失败"
        }`}
        onClose={onClose}
        width="lg"
        footer={
          <Button
            type="button" size="sm" variant="ghost"
            data-testid="chat-attachment-draft-preview-dismiss"
            onClick={onClose}
          >
            关闭
          </Button>
        }
      >
        <div
          className="grid min-h-[240px] place-items-center"
          data-preview-local-id={attachment.localId}
          data-preview-filename={attachment.filename}
          data-testid="chat-attachment-draft-preview-body"
        >
          {isImage && src ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图
            <img
              src={src}
              alt={attachment.filename}
              data-testid="chat-attachment-draft-preview-image"
              data-local-id={attachment.localId}
              className="max-h-[60vh] max-w-full rounded-md object-contain"
            />
          ) : (
            // 非图片：不假装能预览。给类型图标 + 文件名 + 一句实话。
            <div className="flex flex-col items-center gap-2 text-muted-foreground" data-testid="chat-attachment-draft-preview-unsupported">
              <Icon aria-hidden className="h-10 w-10" />
              <p className="text-13">{attachment.filename}</p>
              <p className="text-11">该文件类型在发送前不提供内联预览；发送后可在消息里预览或下载。</p>
            </div>
          )}
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

/**
 * issue #3373 —— composer **内部**的待发附件条：紧凑 chip / 真实缩略图，横向排布、
 * 自动换行，不再是浮在输入框上方那张占一整行的宽卡片。
 *
 * 与被它取代的 `ChatAttachmentList` 的关系：**不是第二份状态**。两者吃同一个
 * `useChatAttachments` 控制器、同一条 pending 队列、同一批 `uploadedIds`；差别只在渲染。
 * `ChatAttachmentList`（宽卡片）仍留给「加材料进这一轮」弹窗与旧轨道 composer——那两处
 * 有横向空间，宽卡片在那里是合适的；输入框里没有。
 *
 * 锚点刻意与旧渲染逐字相同（`chat-attachment-list` / `chat-attachment-chip-<localId>` +
 * `data-status` / `chat-attachment-remove-<localId>` / `chat-attachment-retry-<localId>`）：
 * 既有 e2e（`chat-vision-honest-degrade` / `copilotkit-v2-attachments`）钉的是"待发队列的
 * 真实上传状态机"，那件事没变，不该因为换了个视觉就换一套锚点。
 *
 * 各态：
 *   · uploading —— 缩略图/图标压暗 + 转圈 + 底部细进度条（真实 `progress`，不伪造百分比）
 *   · uploaded  —— 正常，可点开放大预览
 *   · error     —— 红环 + 一句原因（tooltip/aria）+ **重试**按钮（可重试时）+ 移除按钮
 * 每个 chip 都至少有一个真的会响应的动作，没有"点了没反应"的东西（#3311 / #3317 / #3372）。
 *
 * 移除是**一步**，不再二次确认：待发草稿还没发出去，重新拖一次的代价远低于每次删都多点
 * 一次；宽卡片那份二次确认（`ChatAttachmentList`）原样保留，两处各自成立。
 */
export function ChatComposerAttachmentStrip({
  ctl, disabled, canRetry = true, disabledReason,
  testId = "chat-attachment-list", idPrefix = "chat-attachment",
}: {
  ctl: ChatAttachmentsController;
  disabled?: boolean;
  canRetry?: boolean;
  /** #3347 约定：只读/归档时入口仍渲染，但禁用并**写出理由**，不静默消失。 */
  disabledReason?: string;
  testId?: string;
  idPrefix?: string;
}) {
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const previewing = ctl.attachments.find((a) => a.localId === previewId) ?? null;
  // 附件被移除/发送清空后，预览必须跟着关——否则会停在一张已经不属于这条消息的图上。
  React.useEffect(() => {
    if (previewId !== null && !ctl.attachments.some((a) => a.localId === previewId)) setPreviewId(null);
  }, [ctl.attachments, previewId]);

  if (ctl.attachments.length === 0) return null;
  return (
    <>
      <ul
        className="flex flex-wrap items-start gap-2 pb-1"
        data-testid={testId}
        data-disabled={disabled ? "true" : "false"}
      >
        {ctl.attachments.map((att) => (
          <ComposerAttachmentChip
            key={att.localId}
            att={canRetry ? att : { ...att, retryable: false }}
            idPrefix={idPrefix}
            disabled={disabled}
            onOpen={() => setPreviewId(att.localId)}
            onRemove={() => ctl.removeAttachment(att.localId)}
            onRetry={() => ctl.retry(att.localId)}
          />
        ))}
      </ul>
      {disabledReason ? (
        <p className="pb-1 text-10 text-muted-foreground" data-testid={`${idPrefix}-disabled-reason`}>
          {disabledReason}
        </p>
      ) : null}
      {previewing ? (
        <ChatDraftAttachmentPreview attachment={previewing} onClose={() => setPreviewId(null)} />
      ) : null}
    </>
  );
}

function ComposerAttachmentChip({
  att, idPrefix, disabled, onOpen, onRemove, onRetry,
}: {
  att: LiveAttachment;
  idPrefix: string;
  disabled?: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const kind = iconKindForMime(att.mime);
  const Icon = TYPE_ICON[kind];
  const thumbUrl = useLocalFileUrl(isThumbnailable(att) ? att.file : undefined);
  const isError = att.status === "error";
  const isUploading = att.status === "uploading";
  const percent = Math.round((att.progress ?? 0) * 100);
  const statusWord = isUploading ? `上传中 ${percent}%` : isError ? `上传失败：${att.error ?? "未知原因"}` : "已就绪";

  return (
    <li
      className="relative"
      data-testid={`${idPrefix}-chip-${att.localId}`}
      data-status={att.status}
      data-kind={thumbUrl ? "image" : kind}
    >
      <button
        type="button"
        onClick={onOpen}
        title={`${att.filename} · ${formatBytes(att.bytes)} · ${statusWord}`}
        aria-label={`预览附件 ${att.filename}（${statusWord}）`}
        data-testid={`${idPrefix}-open-${att.localId}`}
        className={[
          "group relative flex items-center overflow-hidden rounded-lg border bg-panel text-left transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/60",
          thumbUrl ? "h-16 w-16" : "h-16 max-w-[13rem] gap-2 px-2",
          isError ? "border-destructive/60" : "border-border-subtle",
        ].join(" ")}
      >
        {thumbUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图 */}
            <img
              src={thumbUrl}
              alt={att.filename}
              data-testid={`${idPrefix}-thumb-${att.localId}`}
              data-local-id={att.localId}
              className={`h-full w-full object-cover transition-opacity ${isUploading ? "opacity-50" : ""}`}
            />
            {isUploading ? (
              <span className="absolute inset-0 grid place-items-center" aria-hidden>
                <Loader2 className="h-4 w-4 animate-spin text-card-foreground" />
              </span>
            ) : null}
            {isError ? (
              <span className="absolute inset-0 grid place-items-center bg-destructive/20" aria-hidden>
                <AlertCircle className="h-4 w-4 text-destructive" />
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${
                isError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
              }`}
              aria-hidden
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-11 font-medium text-card-foreground">{att.filename}</span>
              <span className={`truncate text-9 ${isError ? "text-destructive" : "text-muted-foreground"}`}>
                {isError ? att.error : isUploading ? `上传中 ${percent}%` : formatBytes(att.bytes)}
              </span>
            </span>
          </>
        )}
        {isUploading ? (
          <span
            className="absolute inset-x-0 bottom-0 h-0.5 bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`上传进度 ${att.filename}`}
            data-testid={`${idPrefix}-progress-${att.localId}`}
          >
            <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
          </span>
        ) : null}
      </button>

      <span className="absolute -right-1.5 -top-1.5 flex items-center gap-0.5">
        {isError && att.retryable ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            aria-label={`重试上传 ${att.filename}`}
            title="重试上传"
            data-testid={`${idPrefix}-retry-${att.localId}`}
            className="grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors duration-fast hover:bg-muted disabled:bg-disabled disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCw aria-hidden className="h-3 w-3" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除附件 ${att.filename}`}
          title="移除附件"
          data-testid={`${idPrefix}-remove-${att.localId}`}
          className="grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors duration-fast hover:bg-destructive/10 hover:text-destructive disabled:bg-disabled disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      </span>
    </li>
  );
}
