"use client";

/**
 * 迭代 13（design-delta `design-chat-inputs` §1）—— 对话输入框上方的**参考图条**。
 *
 * ## 三条入口，一条上传路径
 *
 * 按钮选文件 / 拖进来 / 直接粘贴（截图党的主路径）——三者都落到同一个 `upload(file)`，
 * 不各写一遍校验。校验本身**不在这里**：类型与大小由服务端按字节判（前端拿到的
 * `file.type` 是浏览器猜的，改个扩展名就能骗过）。这里只做一件前端才知道的事：
 * 已经满 3 张时不发请求，直接说满了。
 *
 * ## 为什么不做「选哪几张发」
 *
 * 参考图是**这个项目的**参考，不是某一句话的附件：用户传它就是希望模型一直照着它画。
 * 每条消息带上项目当前的全部参考图，语义与"贴在墙上的参考"一致；要它不再影响就删掉。
 * 多一个"这轮带哪几张"的勾选，是让用户替模型记账。
 */
import * as React from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PROTOTYPE_MAX_REF_IMAGES,
  type RefImage,
} from "@/lib/live-design-workbench";

/** 被拒的三种情形共用一个错误码，`rejectReason` 决定说哪句话。 */
const REJECT_TEXT: Record<string, string> = {
  TYPE: "这个文件不是 PNG / JPEG / WebP 图片。",
  SIZE: "这张图太大了，单张不能超过 4MB。",
  TOO_MANY: `参考图最多 ${PROTOTYPE_MAX_REF_IMAGES} 张，先删一张再传。`,
};

/**
 * ⚠ 失败信封在 `ApiError.raw` 上，不是 `.body`——写成 `.body` 时**每一种拒绝都会落到
 * 那句兜底文案**，而界面看起来完全正常（有报错、有红字），只是永远说不出到底为什么。
 * 这正是 V59 那条断言在挡的东西（实测：先写成 `.body`，被那条断言抓住）。
 */
export function refImageRejectText(err: unknown): string {
  const raw = (err as { raw?: { rejectReason?: unknown } } | null)?.raw;
  const reason = typeof raw?.rejectReason === "string" ? raw.rejectReason : "";
  return REJECT_TEXT[reason] ?? "这张图没能上传，换一张试试。";
}

export function RefImageStrip({
  images,
  disabled,
  onUpload,
  onDelete,
}: {
  readonly images: readonly RefImage[];
  readonly disabled?: boolean;
  readonly onUpload: (file: File) => Promise<void>;
  readonly onDelete: (imageId: string) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const full = images.length >= PROTOTYPE_MAX_REF_IMAGES;
  const blocked = disabled === true || busy;

  const take = async (file: File | null | undefined) => {
    if (!file || blocked) return;
    if (full) {
      setError(REJECT_TEXT.TOO_MANY!);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setError(refImageRejectText(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 粘贴要挂在 `window` 上而不是某个输入框：截图后用户的焦点常常不在输入框里
   * （刚从截图工具切回来），挂在输入框上会让「Ctrl+V 没反应」看起来像功能坏了。
   */
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .find((f): f is File => f !== null && f.type.startsWith("image/"));
      if (file === undefined) return;
      e.preventDefault();
      void take(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, full]);

  return (
    <div
      className={`mx-3 mb-1 rounded-control border border-dashed px-2 py-1.5 transition-colors duration-fast ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void take(e.dataTransfer.files[0]);
      }}
      data-testid="design-ref-images"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {images.map((img) => (
          <span
            key={img.id}
            className="flex max-w-[9rem] items-center gap-1 rounded-control bg-card px-1.5 py-0.5 text-10 text-muted-foreground"
            data-testid="design-ref-image"
          >
            <span className="truncate text-background-foreground" title={img.name}>{img.name}</span>
            <button
              type="button"
              aria-label={`删除参考图 ${img.name}`}
              disabled={blocked}
              onClick={() => void onDelete(img.id)}
              className="rounded-control p-0.5 transition-colors duration-fast hover:bg-background"
              data-testid="design-ref-image-delete"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-testid="design-ref-image-file"
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked || full}
          onClick={() => fileRef.current?.click()}
          data-testid="design-ref-image-add"
          className="h-6 gap-1 px-1.5 text-10"
        >
          {busy ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <ImagePlus aria-hidden className="h-3 w-3" />}
          参考图
        </Button>
        <span className="text-10 text-muted-foreground">
          {full ? `已满 ${PROTOTYPE_MAX_REF_IMAGES} 张` : "拖进来 / 粘贴截图也行"}
        </span>
      </div>
      {error !== null && (
        <p className="mt-1 text-10 text-destructive-foreground" role="status" data-testid="design-ref-image-error">{error}</p>
      )}
    </div>
  );
}
