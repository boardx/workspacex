import * as React from "react";
import Link from "next/link";
import { ChatFileUploadPreview } from "@/components/chat/chat-file-upload-preview";
import { UPLOAD_SCENES, resolveScene } from "@/lib/chat-file-upload-scenes";

/**
 * chat-file-upload（V9 文件上传）UI 先行原型入口 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**（V9-a 后端未建；本仓「无真实数据不做假 UI」红线）。
 *   这里做的是**签核材料**，显式标注 mock，不混进活路由 `chat-live-message-panel.tsx`。
 *
 * query 参数（预览手段，非权限实现）：
 *   ?scene= default | dragover | attached | uploading
 *         | error-oversize | error-type | error-count | error-retry | remove-confirm
 *
 * 顶部是一排场景切换链接，让人类 sign-off 时逐态点选核对。
 */
export default function ChatFileUploadPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string };
}) {
  const scene = resolveScene(searchParams.scene);
  return (
    <main className="min-h-screen bg-background text-foreground">
      <nav
        className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
        data-testid="chat-file-upload-scene-nav"
      >
        <span className="mr-1 text-11 font-medium text-muted-foreground">界面态</span>
        {UPLOAD_SCENES.map((s) => {
          const active = s === scene;
          return (
            <Link
              key={s}
              href={`/preview/chat-file-upload?scene=${s}`}
              data-testid={`chat-file-upload-scene-${s}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-200 ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {s}
            </Link>
          );
        })}
      </nav>
      <ChatFileUploadPreview scene={scene} />
    </main>
  );
}
