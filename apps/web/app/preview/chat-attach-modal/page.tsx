"use client";
import * as React from "react";
import {
  ChatAttachMaterialModal,
  type ChatAttachmentsController,
  type LiveAttachment,
} from "@/components/chat/chat-composer-attachments";

/**
 * 「加材料进这一轮」面板 —— ADR-023 ① UI 签核**增量**材料入口（无鉴权预览）。
 *
 * ⚠ 纯前端 mock：用假 controller 喂各态，**不接后端**（活链路要登录，签核截图走这里）。
 * 展示第一版从简口径：25MB / 上传进度条 / 列出全部已传文件；**不含**被砍的 token 计数 /
 * 逐文件勾选进上下文 / 机密→本地模型路由（不留假占位）。活组件本体是
 * `components/chat/chat-composer-attachments.tsx` 的 `ChatAttachMaterialModal`。
 */
const noop = () => undefined;

function att(p: Partial<LiveAttachment> & Pick<LiveAttachment, "localId" | "filename" | "mime" | "bytes" | "status">): LiveAttachment {
  return p;
}

const SCENES = {
  mix: [
    att({ localId: "a1", filename: "季度供应商评估.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: 12_582_912, status: "uploaded" }),
    att({ localId: "a2", filename: "在建项目规模统计.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: 3_145_728, status: "uploading", progress: 0.6 }),
    att({ localId: "a3", filename: "现场照片.png", mime: "image/png", bytes: 8_388_608, status: "error", error: "存储暂不可用，请重试", retryable: true }),
  ],
  empty: [],
  atlimit: Array.from({ length: 10 }, (_v, i) =>
    att({ localId: `l${i}`, filename: `资料-${i + 1}.pdf`, mime: "application/pdf", bytes: 1_048_576, status: "uploaded" })),
} satisfies Record<string, LiveAttachment[]>;

function mockCtl(attachments: LiveAttachment[]): ChatAttachmentsController {
  return {
    attachments,
    banner: null,
    dragActive: false,
    confirmingId: null,
    fileInputRef: { current: null },
    atLimit: attachments.length >= 10,
    hasUploading: attachments.some((a) => a.status === "uploading"),
    uploadedIds: [],
    dragHandlers: { onDragOver: noop, onDragLeave: noop, onDrop: noop },
    pickFiles: noop,
    retry: noop,
    removeAttachment: noop,
    clear: noop,
    askRemove: noop,
    cancelRemove: noop,
    openFileDialog: noop,
  } as unknown as ChatAttachmentsController;
}

export default function ChatAttachModalPreviewPage() {
  const [scene, setScene] = React.useState<keyof typeof SCENES>("mix");
  return (
    <main className="min-h-screen bg-background p-6 text-background-foreground">
      {/* 场景切换器：z 高于面板（面板 z-40），签核时逐态点选核对 */}
      <nav className="fixed left-4 top-4 z-50 flex gap-1.5" data-testid="chat-attach-modal-scene-nav">
        {(Object.keys(SCENES) as Array<keyof typeof SCENES>).map((s) => (
          <button
            key={s}
            data-testid={`chat-attach-modal-scene-${String(s)}`}
            data-active={s === scene}
            onClick={() => setScene(s)}
            className={`rounded-full border px-2.5 py-1 text-11 transition-colors ${
              s === scene ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </nav>
      <p className="text-12 text-muted-foreground">「加材料进这一轮」面板 · 签核 ① UI 增量预览（mock，不接后端）</p>
      <ChatAttachMaterialModal ctl={mockCtl(SCENES[scene])} open onClose={noop} />
    </main>
  );
}
