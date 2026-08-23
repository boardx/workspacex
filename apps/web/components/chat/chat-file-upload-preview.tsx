"use client";

import * as React from "react";
import {
  AlertCircle,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Presentation,
  RotateCw,
  Send,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ATTACHED_SAMPLE,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MIME_WHITELIST,
  OVERSIZE_SAMPLE,
  RETRY_SAMPLE,
  UPLOADING_SAMPLE,
  WHITELIST_LABELS,
  formatBytes,
  iconKindForMime,
  type AttachmentIconKind,
  type MockAttachment,
} from "@/lib/mock/chat-file-upload";
import { type UploadScene } from "@/lib/chat-file-upload-scenes";

/**
 * V9 文件上传 —— composer 附件能力的**签核原型**（ADR-023 第 ① 件 UI 材料）。
 *
 * ⚠ 纯前端 mock，不接后端（V9-a 后端未建）。它**不是**活路由：生产 composer 是
 *   `chat-live-message-panel.tsx`，那条路径保持「无真实数据不做假 UI」红线不变。
 *   本组件只在 `/preview/chat-file-upload` 下渲染，供人类 sign-off 时点选六种界面态。
 *
 * 六种态由 `scene` 驱动（截图取证用），但组件本身可交互：点 📎 会真的开文件选择框、
 * 选真实文件会跑签核参数的就地校验、✕ 会弹二次确认——让人类「点得动、看得到」。
 *
 * 参数（25MB / 10 个 / MIME 白名单）单一事实源在 `lib/mock/chat-file-upload.ts`，
 * 本文件不再手写第二份。
 */
const SCENE_LABEL: Record<UploadScene, string> = {
  default: "默认态 · composer 里的 📎 附件按钮",
  dragover: "拖拽态 · 文件拖到输入区时的高亮落区",
  attached: "已挂附件 · 预览条（文件名 + 类型图标 + 大小 + ✕）",
  uploading: "上传中 · 逐条进度指示",
  "error-oversize": "失败 · 单文件超 25MB 就地报错",
  "error-type": "失败 · 非白名单类型被拒",
  "error-count": "失败 · 超过 10 个附件被拒",
  "error-retry": "失败 · 上传中断，可重试",
  "remove-confirm": "二次确认 · 移除某个附件",
};

interface BannerState {
  readonly kind: "oversize" | "type" | "count";
  readonly text: string;
}

const TYPE_ICON: Record<AttachmentIconKind, LucideIcon> = {
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  image: FileImage,
  text: FileText,
  file: FileIcon,
};

function seedFor(scene: UploadScene): {
  attachments: MockAttachment[];
  banner: BannerState | null;
  dragActive: boolean;
  confirmingId: string | null;
} {
  switch (scene) {
    case "default":
      return { attachments: [], banner: null, dragActive: false, confirmingId: null };
    case "dragover":
      return { attachments: [], banner: null, dragActive: true, confirmingId: null };
    case "attached":
      return { attachments: ATTACHED_SAMPLE, banner: null, dragActive: false, confirmingId: null };
    case "uploading":
      return { attachments: UPLOADING_SAMPLE, banner: null, dragActive: false, confirmingId: null };
    case "error-oversize":
      return {
        attachments: OVERSIZE_SAMPLE,
        banner: {
          kind: "oversize",
          text: `「产品全量演示录屏.mp4-封面帧.png」超过单个文件 ${formatBytes(MAX_FILE_BYTES)} 上限，未添加。`,
        },
        dragActive: false,
        confirmingId: null,
      };
    case "error-type":
      return {
        attachments: ATTACHED_SAMPLE.slice(0, 1),
        banner: {
          kind: "type",
          text: `不支持的文件类型「demo.zip」。支持：${WHITELIST_LABELS}。`,
        },
        dragActive: false,
        confirmingId: null,
      };
    case "error-count":
      return {
        attachments: ATTACHED_SAMPLE.concat([
          { id: "a9", filename: "补充材料-1.pdf", mime: "application/pdf", bytes: 220_400, status: "done" },
          { id: "a10", filename: "补充材料-2.pdf", mime: "application/pdf", bytes: 180_220, status: "done" },
        ]),
        banner: {
          kind: "count",
          text: `每条消息最多 ${MAX_ATTACHMENTS} 个附件，已达上限，多出的 1 个未添加。`,
        },
        dragActive: false,
        confirmingId: null,
      };
    case "error-retry":
      return { attachments: RETRY_SAMPLE, banner: null, dragActive: false, confirmingId: null };
    case "remove-confirm":
      return { attachments: ATTACHED_SAMPLE, banner: null, dragActive: false, confirmingId: "a4" };
    default:
      return { attachments: [], banner: null, dragActive: false, confirmingId: null };
  }
}

export function ChatFileUploadPreview({ scene }: { scene: UploadScene }) {
  const seed = React.useMemo(() => seedFor(scene), [scene]);
  const [attachments, setAttachments] = React.useState<MockAttachment[]>(seed.attachments);
  const [banner, setBanner] = React.useState<BannerState | null>(seed.banner);
  const [dragActive, setDragActive] = React.useState(seed.dragActive);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(seed.confirmingId);
  const [text, setText] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setAttachments(seed.attachments);
    setBanner(seed.banner);
    setDragActive(seed.dragActive);
    setConfirmingId(seed.confirmingId);
  }, [seed]);

  const atLimit = attachments.length >= MAX_ATTACHMENTS;
  const whitelistMimes = React.useMemo(() => new Set(MIME_WHITELIST.map((m) => m.mime)), []);

  const ingest = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let next = attachments.slice();
    let nextBanner: BannerState | null = null;
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS) {
        nextBanner = { kind: "count", text: `每条消息最多 ${MAX_ATTACHMENTS} 个附件，已达上限。` };
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        nextBanner = {
          kind: "oversize",
          text: `「${file.name}」超过单个文件 ${formatBytes(MAX_FILE_BYTES)} 上限，未添加。`,
        };
        continue;
      }
      if (file.type && !whitelistMimes.has(file.type)) {
        nextBanner = { kind: "type", text: `不支持的文件类型「${file.name}」。支持：${WHITELIST_LABELS}。` };
        continue;
      }
      next = next.concat({
        id: `u${Date.now()}${next.length}`,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        bytes: file.size,
        status: "done",
      });
    }
    setAttachments(next);
    setBanner(nextBanner);
  };

  const removeAttachment = (id: string) => {
    setAttachments((cur) => cur.filter((a) => a.id !== id));
    setConfirmingId(null);
  };

  return (
    <section
      className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4"
      data-testid="chat-file-upload-preview"
      data-scene={scene}
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge tone="ai">原型 · mock 数据</Badge>
          <span className="text-11 text-muted-foreground">V9 文件上传 · 签核第 ① 件（UI）</span>
        </div>
        <p className="text-12 text-card-foreground">{SCENE_LABEL[scene]}</p>
      </header>

      {/* composer 外框——沿用活路由 chat-live-message-panel 的 composer 视觉：圆角卡 + 底部控件行 */}
      <div className="border-t border-border pt-3" data-testid="chat-attachment-composer">
        {/*
          就地报错横幅：超大小 / 非白名单 / 超数量三类共用，不静默丢弃（signoff ② UC3）。
          用 destructive token 的低透明度底色（alpha tint，不是 opacity 状态类），文字用 text-destructive。
        */}
        {banner ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-11 text-destructive"
            data-testid="chat-attachment-error"
            data-error-kind={banner.kind}
            role="alert"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{banner.text}</span>
          </div>
        ) : null}

        <div
          className={`relative rounded-2xl border bg-card p-1.5 shadow-sm transition-all duration-200 ${
            dragActive ? "border-primary ring-2 ring-primary" : "border-border-subtle"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            ingest(e.dataTransfer.files);
          }}
        >
          {/* 拖拽高亮落区——覆盖在 composer 上，明确「松手即添加」 */}
          {dragActive ? (
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
          ) : null}

          {/* 附件预览条：文件名 + 类型图标 + 大小 + ✕ 移除；一条消息可挂多个（signoff ① / ② UC1） */}
          {attachments.length > 0 ? (
            <ul className="flex flex-col gap-1.5 px-1 pb-1.5 pt-1" data-testid="chat-attachment-list">
              {attachments.map((att) => (
                <AttachmentRow
                  key={att.id}
                  att={att}
                  confirming={confirmingId === att.id}
                  onAskRemove={() => setConfirmingId(att.id)}
                  onCancelRemove={() => setConfirmingId(null)}
                  onConfirmRemove={() => removeAttachment(att.id)}
                  onRetry={() =>
                    setAttachments((cur) =>
                      cur.map((a) => (a.id === att.id ? { ...a, status: "uploading", progress: 8, error: undefined } : a)),
                    )
                  }
                />
              ))}
            </ul>
          ) : null}

          <Textarea
            data-testid="chat-attachment-textarea"
            aria-label="消息内容"
            placeholder="写点什么，或把文件拖到这里一起发送"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-16 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
            <div className="flex items-center gap-1.5">
              {/*
                📎 附件按钮（signoff ① / testid 锚点 chat-attachment-input）。点击打开真实文件
                选择框——让人类真的能选文件、触发签核参数校验。达上限时禁用（token 禁用态）。
              */}
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="rounded-full"
                data-testid="chat-attachment-input"
                aria-label="添加附件"
                title={
                  atLimit
                    ? `已达 ${MAX_ATTACHMENTS} 个附件上限`
                    : `添加附件（单个不超过 ${formatBytes(MAX_FILE_BYTES)}，最多 ${MAX_ATTACHMENTS} 个）`
                }
                disabled={atLimit}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={MIME_WHITELIST.map((m) => m.mime).join(",")}
                className="hidden"
                data-testid="chat-attachment-file-input"
                onChange={(e) => {
                  ingest(e.target.files);
                  e.target.value = "";
                }}
              />
              {/* 计数：N/10，达上限转警示色（token，非 opacity） */}
              <span
                className={`text-10 ${atLimit ? "text-warning" : "text-muted-foreground"}`}
                data-testid="chat-attachment-count"
              >
                {attachments.length}/{MAX_ATTACHMENTS}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="rounded-full"
                data-testid="chat-attachment-mic"
                aria-label="语音输入"
                title="语音输入"
              >
                <Mic aria-hidden className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="rounded-full"
                data-testid="chat-attachment-submit"
                aria-label="发送并排队"
                title="发送并排队（⌘↵）"
              >
                <Send aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <p className="px-1.5 pt-1 text-10 text-muted-foreground">
          附件随消息一起持久化，随线程删除；单个不超过 {formatBytes(MAX_FILE_BYTES)}，每条消息最多
          {" "}
          {MAX_ATTACHMENTS} 个，支持 {WHITELIST_LABELS}。
        </p>
      </div>
    </section>
  );
}

function AttachmentRow({
  att,
  confirming,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
  onRetry,
}: {
  att: MockAttachment;
  confirming: boolean;
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
      data-testid={`chat-attachment-chip-${att.id}`}
      data-status={att.status}
    >
      <div className="flex items-center gap-2">
        <div
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
            isError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
          }`}
          aria-hidden
        >
          {isUploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Icon aria-hidden className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-12 font-medium text-card-foreground" title={att.filename}>
              {att.filename}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-10 text-muted-foreground">
            <span>{formatBytes(att.bytes)}</span>
            {isUploading ? <span>· 上传中 {att.progress ?? 0}%</span> : null}
            {att.status === "done" ? <Badge tone="outline">已就绪</Badge> : null}
            {isError ? <span className="text-destructive">· {att.error}</span> : null}
          </div>
          {isUploading ? (
            <Progress value={att.progress ?? 0} className="mt-1" label={`上传 ${att.filename}`} />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isError && att.retryable ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="rounded-md"
              data-testid={`chat-attachment-retry-${att.id}`}
              onClick={onRetry}
            >
              <RotateCw aria-hidden className="h-3 w-3" />
              重试
            </Button>
          ) : null}
          {/* ✕ 移除——危险动作，点后弹二次确认，不直接删（signoff ① / R8 危险动作要显式） */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-md"
            data-testid={`chat-attachment-remove-${att.id}`}
            aria-label={`移除附件 ${att.filename}`}
            title="移除附件"
            onClick={onAskRemove}
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 移除二次确认——就地弹出，说明影响范围（附件将不随此消息发送），非孤零零红按钮 */}
      {confirming ? (
        <div
          className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
          data-testid={`chat-attachment-remove-confirm-${att.id}`}
          role="alertdialog"
          aria-label="确认移除附件"
        >
          <span className="flex items-center gap-1.5 text-11 text-card-foreground">
            <Trash2 aria-hidden className="h-3.5 w-3.5 text-destructive" />
            移除「{att.filename}」？它不会随这条消息发送。
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              data-testid={`chat-attachment-remove-cancel-${att.id}`}
              onClick={onCancelRemove}
            >
              取消
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              data-testid={`chat-attachment-remove-yes-${att.id}`}
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
