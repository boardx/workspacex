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
import { describeFailure } from "@/lib/design-failure";
import {
  PROTOTYPE_MAX_REF_IMAGES,
  PROTOTYPE_REF_IMAGE_MAX_BYTES,
  type RefImage,
} from "@/lib/live-design-workbench";

/**
 * 迭代 31：「4MB」原来是手打在这句话里的字面量，而真正判大小的是契约常量
 * `PROTOTYPE_REF_IMAGE_MAX_BYTES`。上限一改，服务端拒得更早、屏上还在说 4MB——
 * 同一事实的第二份副本，本仓已经因此漂过五次。现在从常量算出来。
 */
const MAX_MB = Math.round(PROTOTYPE_REF_IMAGE_MAX_BYTES / (1024 * 1024));

/** 被拒的三种情形共用一个错误码，`rejectReason` 决定说哪句话。 */
const REJECT_TEXT: Record<string, string> = {
  TYPE: "这个文件不是 PNG / JPEG / WebP 图片。",
  SIZE: `这张图太大了，单张不能超过 ${MAX_MB}MB。`,
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
  const known = REJECT_TEXT[reason];
  if (known !== undefined) return known;
  /*
   * 迭代 31：兜底原来一律是「这张图没能上传，换一张试试」——断网、登录过期、
   * 服务端 500 时都这么说，于是用户去换图，换十张也一样。不是图的问题就别怪图。
   */
  return `这张图没能上传：${describeFailure(err)}`;
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

  /**
   * 迭代 31：一次拖进来好几张时，原来是 `take(files[0])` —— 第一张上传，其余**静默消失**。
   * 用户看到条上多了一张，以为另外两张也在，下一句"照这三张画"就全错了。
   * 这里不改成批量上传（服务端一次只收一张，改成串行上传是另一件事），
   * 而是**如实说**只收了一张、剩下的要一张一张来。
   */
  const takeMany = (files: readonly File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (files.length > 0 && imgs.length === 0) {
      setError("这里只收图片（PNG / JPEG / WebP）。");
      return;
    }
    const first = imgs[0];
    if (first === undefined) return;
    void take(first).then(() => {
      if (imgs.length > 1) setError(`一次只能传一张，这次收下了「${first.name}」；另外 ${imgs.length - 1} 张请再拖一次。`);
    });
  };

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
        takeMany(Array.from(e.dataTransfer.files));
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
          {/*
            * 迭代 25：标签从名词「参考图」改成动作。第一次来的人扫过这一行时要判断的是
            * 「我能干什么」，而「参考图」既像标题也像状态，最不像一个能按的东西；
            * 新建弹窗里那个同功能入口（`ref-image-picker.tsx`）用的就是这句话，两处对齐。
            */}
          {images.length === 0 ? "照着一张图画" : `参考图 ${String(images.length)}`}
        </Button>
        <span className="text-10 text-muted-foreground">
          {/* 迭代 31：上传中只有按钮上一个小转圈。大图传几秒，屏上得有一句话说它在动。 */}
          {busy ? "正在上传…" : full ? `已满 ${PROTOTYPE_MAX_REF_IMAGES} 张` : "拖进来 / 粘贴截图也行"}
        </span>
      </div>
      {error !== null && (
        <p className="mt-1 text-10 text-destructive-foreground" role="status" data-testid="design-ref-image-error">{error}</p>
      )}
    </div>
  );
}
