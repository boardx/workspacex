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
import {
  AlertCircle, File as FileIcon, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip,
  Presentation, RotateCw, Trash2, UploadCloud, X, type LucideIcon,
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
  /** 保留原 File 供重试。 */
  readonly file?: File;
}

interface BannerState {
  readonly kind: "oversize" | "type" | "count";
  readonly text: string;
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
 * composer 附件状态机。`threadId` 变（切线程）会清空——一个线程的 pending 附件不该带到另一个。
 */
export function useChatAttachments(opts: { threadId: string; bearer?: string }) {
  const { threadId, bearer } = opts;
  const [attachments, setAttachments] = React.useState<LiveAttachment[]>([]);
  const [banner, setBanner] = React.useState<BannerState | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    // 切线程：清空本地附件态（不影响服务端已落的 pending 行，那些随线程/未挂而存在）。
    setAttachments([]);
    setBanner(null);
    setConfirmingId(null);
  }, [threadId]);

  const patch = React.useCallback((localId: string, next: Partial<LiveAttachment>) => {
    setAttachments((cur) => cur.map((a) => (a.localId === localId ? { ...a, ...next } : a)));
  }, []);

  const doUpload = React.useCallback(async (localId: string, file: File) => {
    try {
      const uploaded: ChatAttachment = await uploadAttachment(threadId, file, bearer);
      patch(localId, { status: "uploaded", serverId: uploaded.id, bytes: uploaded.bytes, mime: uploaded.mime });
    } catch (err) {
      const { text, retryable } = describeUploadError(err);
      patch(localId, { status: "error", error: text, retryable });
    }
  }, [threadId, bearer, patch]);

  /** 选择/拖入文件：客户端预检（数量/大小/类型，只为快反馈，服务端仍权威）→ 逐个并发上传。 */
  const pickFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setBanner(null);
    setAttachments((cur) => {
      let running = cur.length;
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
          bytes: file.size, status: "uploading", file,
        });
        toUpload.push({ localId, file });
        running += 1;
      }
      if (nextBanner) setBanner(nextBanner);
      // 上传在 setState 之外触发（副作用），但 id 已定，安全。
      queueMicrotask(() => { for (const u of toUpload) void doUpload(u.localId, u.file); });
      return added.length > 0 ? cur.concat(added) : cur;
    });
  }, [doUpload]);

  const retry = React.useCallback((localId: string) => {
    setAttachments((cur) => {
      const target = cur.find((a) => a.localId === localId);
      if (target?.file) {
        queueMicrotask(() => void doUpload(localId, target.file!));
        return cur.map((a) => (a.localId === localId ? { ...a, status: "uploading", error: undefined } : a));
      }
      return cur;
    });
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

  const dragHandlers = React.useMemo(() => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragActive(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); pickFiles(e.dataTransfer.files); },
  }), [pickFiles]);

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

export function ChatAttachmentBanner({ banner }: { banner: BannerState | null }) {
  if (!banner) return null;
  return (
    <div
      className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-11 text-destructive"
      data-testid="chat-attachment-error"
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

export function ChatAttachmentList({ ctl, disabled }: { ctl: ChatAttachmentsController; disabled?: boolean }) {
  if (ctl.attachments.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 px-1 pb-1.5 pt-1" data-testid="chat-attachment-list">
      {ctl.attachments.map((att) => (
        <AttachmentRow
          key={att.localId}
          att={att}
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

/** 📎 按钮 + 隐藏文件输入 + 计数。放在 composer 底部控件行左侧。 */
export function ChatAttachmentButton({ ctl, disabled }: { ctl: ChatAttachmentsController; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="rounded-full"
        data-testid="chat-attachment-input"
        aria-label="添加附件"
        title={ctl.atLimit
          ? `已达 ${MAX_ATTACHMENTS} 个附件上限`
          : `添加附件（单个不超过 ${formatBytes(MAX_FILE_BYTES)}，最多 ${MAX_ATTACHMENTS} 个）`}
        disabled={disabled || ctl.atLimit}
        onClick={ctl.openFileDialog}
      >
        <Paperclip aria-hidden className="h-3.5 w-3.5" />
      </Button>
      <input
        ref={ctl.fileInputRef}
        type="file"
        multiple
        accept={(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).join(",")}
        className="hidden"
        data-testid="chat-attachment-file-input"
        onChange={(e) => { ctl.pickFiles(e.target.files); e.target.value = ""; }}
      />
      {ctl.attachments.length > 0 ? (
        <span
          className={`text-10 ${ctl.atLimit ? "text-warning" : "text-muted-foreground"}`}
          data-testid="chat-attachment-count"
        >
          {ctl.attachments.length}/{MAX_ATTACHMENTS}
        </span>
      ) : null}
    </div>
  );
}

/**
 * #946 · V9-a F152：消息气泡下的**只读**附件展示（listMessages 的 attachments 投影）。
 * 与 composer 的可编辑预览条不同：这里没有移除/重试，只有文件名 + 类型图标 + 大小。
 */
export function MessageAttachments({ attachments }: { attachments: readonly ChatAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-1" data-testid="chat-message-attachments">
      {attachments.map((att) => {
        const Icon = TYPE_ICON[iconKindForMime(att.mime)];
        return (
          <li
            key={att.id}
            className="flex items-center gap-2 rounded-lg border border-border-subtle bg-panel px-2 py-1"
            data-testid={`chat-message-attachment-${att.id}`}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-11 text-card-foreground" title={att.filename}>{att.filename}</span>
            <span className="ml-auto shrink-0 text-10 text-muted-foreground">{formatBytes(att.bytes)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AttachmentRow({
  att, confirming, disabled, onAskRemove, onCancelRemove, onConfirmRemove, onRetry,
}: {
  att: LiveAttachment;
  confirming: boolean;
  disabled?: boolean;
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
      className={`relative rounded-lg border bg-panel px-2 py-1.5 transition-colors duration-200 ${
        isError ? "border-destructive/40" : "border-border-subtle"
      }`}
      data-testid={`chat-attachment-chip-${att.localId}`}
      data-status={att.status}
    >
      <div className="flex items-center gap-2">
        <div
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
            isError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          }`}
          aria-hidden
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon aria-hidden className="h-3.5 w-3.5" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-12 font-medium text-card-foreground" title={att.filename}>
            {att.filename}
          </span>
          <div className="flex items-center gap-1.5 text-10 text-muted-foreground">
            <span>{formatBytes(att.bytes)}</span>
            {isUploading ? <span>· 上传中…</span> : null}
            {att.status === "uploaded" ? <Badge tone="outline">已就绪</Badge> : null}
            {isError ? <span className="text-destructive">· {att.error}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isError && att.retryable ? (
            <Button
              type="button" size="xs" variant="outline" className="rounded-md"
              data-testid={`chat-attachment-retry-${att.localId}`}
              disabled={disabled}
              onClick={onRetry}
            >
              <RotateCw aria-hidden className="h-3 w-3" />
              重试
            </Button>
          ) : null}
          <Button
            type="button" size="icon" variant="ghost" className="h-6 w-6 rounded-md"
            data-testid={`chat-attachment-remove-${att.localId}`}
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
          data-testid={`chat-attachment-remove-confirm-${att.localId}`}
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
              data-testid={`chat-attachment-remove-cancel-${att.localId}`}
              onClick={onCancelRemove}
            >
              取消
            </Button>
            <Button
              type="button" size="xs" variant="destructive"
              data-testid={`chat-attachment-remove-yes-${att.localId}`}
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
