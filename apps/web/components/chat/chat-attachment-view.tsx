"use client";

/**
 * 附件的**内联渲染**——取字节 + 五种渲染态，与「摆在哪」无关。
 *
 * ## 为什么抽出来（2026-09-24，评测集 E4）
 *
 * 人类问「现在可以在 chat 右边预览文件吗」。查下来：markdown 产物与文本结果可以
 * （R2–R11），但**上传的材料与生成的文件仍然只弹模态**——模态挡住对话，正是
 * 「对标 Claude Code」要消灭的那件事。
 *
 * 渲染本身早就齐了（image / pdf / slides / text / 不支持，pptx 还有前端渲染器），
 * 只是被焊死在 `ChatAttachmentPreviewModal` 里。这里把它原样搬出来，
 * 让右栏与模态**共用同一份**：同一个文件在两处渲染出来的东西逐字一致，
 * 不会因为摆在两个地方而长成两样（同 `ChatArtifactView` 那次的理由）。
 *
 * ⚠ 取字节仍走 `useAuthedImageSrc`（名字带 Image，实现本就是任意字节通用的）：
 * 裸 `<img src>` / `<iframe src>` 发不出 `Authorization` 头，必须手动 fetch 带 Bearer
 * 再转 blob URL。不另写第二份取字节实现。
 */
import * as React from "react";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { iconKindForMime, type AttachmentIconKind } from "@/lib/chat-attachment-format";
import { ChatAttachmentSlidesPreview } from "./chat-attachment-slides-preview";

/** 五种渲染态：内联图片 / PDF / pptx / UTF-8 文本 / 无法内联。 */
export function previewMode(
  kind: AttachmentIconKind,
  mime: string,
): "image" | "pdf" | "slides" | "text" | "unsupported" {
  const normalizedMime = mime.split(";", 1)[0]?.trim().toLowerCase();
  if (kind === "image") return "image";
  if (kind === "pdf") return "pdf";
  if (kind === "slides") return "slides";
  if (kind === "text" || normalizedMime === "application/json") return "text";
  return "unsupported";
}

export function TextAttachmentPreview({ src }: { src: string }) {
  const [text, setText] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setText(null); setFailed(false);
    fetch(src, { signal: controller.signal }).then((response) => response.text()).then(setText).catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") setFailed(true);
    });
    return () => { controller.abort(); };
  }, [src]);
  if (failed) return <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-text-failed">文本预览加载失败，请下载查看。</p>;
  if (text === null) return <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-text-loading">正在读取内容…</p>;
  return <pre className="max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-muted p-3 text-11 text-card-foreground" data-testid="chat-attachment-preview-text">{text}</pre>;
}

export interface AttachmentViewHandle {
  /** 已取到的 blob URL；`null` = 还没取到或取失败。下载按钮据此开关。 */
  readonly src: string | null;
  readonly failed: boolean;
}

/**
 * 渲染一份附件。
 *
 * @param onState 把取字节的状态回给宿主（模态的页脚下载键、右栏的动作条都要它）。
 *   与 `ChatArtifactView` 的 `onLoaded` 同一条约定：**宿主不自己再取一遍源**，
 *   否则会出现「看到的是这一份、下载到的是另一份」。
 * @param compact 右栏比模态窄得多：图片/PDF 的高度按容器走，不用 60vh 的固定值。
 */
export function ChatAttachmentView({
  threadId, attachmentId, filename, mime, compact = false, onState,
}: {
  readonly threadId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly mime: string;
  readonly compact?: boolean;
  readonly onState?: (state: AttachmentViewHandle) => void;
}): React.JSX.Element {
  const contentUrl = apiUrl(`/chat/threads/${threadId}/attachments/${attachmentId}/content`);
  const { src, failed } = useAuthedImageSrc(contentUrl);
  const mode = previewMode(iconKindForMime(mime), mime);

  const notify = React.useRef(onState);
  notify.current = onState;
  React.useEffect(() => { notify.current?.({ src, failed }); }, [src, failed]);

  const mediaClass = compact
    ? "max-h-full max-w-full rounded-md object-contain"
    : "max-h-[60vh] max-w-full rounded-md object-contain";
  const frameClass = compact
    ? "h-full min-h-[320px] w-full rounded-md border border-border-subtle"
    : "h-[60vh] w-full rounded-md border border-border-subtle";

  if (failed) {
    return <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-failed">加载失败，请重试或直接下载。</p>;
  }
  if (!src) {
    return <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-loading">正在加载…</p>;
  }
  if (mode === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图
    return <img src={src} alt={filename} className={mediaClass} data-testid="chat-attachment-preview-image" />;
  }
  if (mode === "pdf") {
    return <iframe src={src} title={filename} className={frameClass} data-testid="chat-attachment-preview-pdf" />;
  }
  if (mode === "slides") {
    return <ChatAttachmentSlidesPreview src={src} filename={filename} />;
  }
  if (mode === "text") {
    return <TextAttachmentPreview src={src} />;
  }
  return (
    <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-unsupported">
      该文件类型不支持预览，请下载查看。
    </p>
  );
}
