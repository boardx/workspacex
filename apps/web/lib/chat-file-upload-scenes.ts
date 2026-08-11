/**
 * V9 文件上传原型的场景枚举与纯函数 —— **刻意不带 `"use client"`**。
 *
 * 原因同 `lib/ui-state.ts`：标了 `"use client"` 的模块，其全部导出都会变成客户端引用，
 * 服务端组件 import 进来后对它调用 `.includes()` 会报「Attempted to call … from the
 * server but … is on the client」。所以「类型 + 场景列表 + 解析函数」放这里（无指令），
 * 「组件」放 `components/chat/chat-file-upload-preview.tsx`（带 `"use client"`）。
 */
export type UploadScene =
  | "default"
  | "dragover"
  | "attached"
  | "uploading"
  | "error-oversize"
  | "error-type"
  | "error-count"
  | "error-retry"
  | "remove-confirm";

export const UPLOAD_SCENES: UploadScene[] = [
  "default",
  "dragover",
  "attached",
  "uploading",
  "error-oversize",
  "error-type",
  "error-count",
  "error-retry",
  "remove-confirm",
];

export function resolveScene(raw: string | string[] | undefined): UploadScene {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return UPLOAD_SCENES.includes(v as UploadScene) ? (v as UploadScene) : "default";
}
