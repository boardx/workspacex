"use client";

/**
 * issue #1980 —— pptx 内联预览。纯前端渲染，不依赖后端转换。
 *
 * 用开源库 `pptx-preview`（ISC，npm 包本身「自用商用均可免费使用」——注意它的源码另有
 * 「仅供个人学习、不得转为自有项目开源」的限制条款，我们只是把编译产物当依赖装，不涉及
 * 修改/转发源码，不冲突）。`init(dom, options).preview(arrayBuffer)`：ESM、带 `.d.ts`
 * 类型、无 jQuery 依赖，`mode: "list"` 一次把全部幻灯片渲染成可滚动列表，不需要额外做
 * 轮播控件。
 *
 * 字节来源：父组件 `ChatAttachmentPreviewModal` 已经用 `useAuthedImageSrc` 把附件字节拉成
 * blob URL（`src`）。这里 `fetch(src)` 读的是浏览器本地 blob 存储，不是再打一次带鉴权的
 * 网络请求——避免重复打 `.../content` 端点。
 *
 * `pptx-preview` 依赖 `echarts`（渲染图表用），体积不小，所以用动态 `import()` 放进
 * `useEffect`，只有真的挂载出一个 pptx 预览时才加载，不进主 bundle、也不在 SSR 阶段跑
 * （父组件本身已经是仅客户端挂载的 portal，这里再动态 import 双重保险）。
 */
import * as React from "react";

type PptxPreviewer = { preview: (file: ArrayBuffer) => Promise<unknown>; destroy: () => void };

export function ChatAttachmentSlidesPreview({
  src, filename,
}: {
  src: string;
  filename: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let previewer: PptxPreviewer | null = null;
    setFailed(false);

    (async () => {
      try {
        const [{ init }, res] = await Promise.all([import("pptx-preview"), fetch(src)]);
        if (cancelled) return;
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) throw new Error("slides_container_unmounted");
        container.innerHTML = "";
        previewer = init(container, { width: 960, height: 540, mode: "list" }) as unknown as PptxPreviewer;
        await previewer.preview(buffer);
        if (cancelled) return;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      previewer?.destroy();
    };
  }, [src]);

  if (failed) {
    // 与「该文件类型不支持预览」区分开——这里是「有渲染器但渲染失败」的运行时异常态，
    // 不是「压根没有渲染器」，文案不能混用。
    return (
      <p className="text-13 text-muted-foreground" data-testid="chat-attachment-preview-slides-failed">
        预览渲染失败，请下载查看。
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label={filename}
      className="max-h-[60vh] w-full overflow-y-auto rounded-md border border-border-subtle"
      data-testid="chat-attachment-preview-slides"
    />
  );
}
