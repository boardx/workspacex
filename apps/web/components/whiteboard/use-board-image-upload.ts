"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { inspectRemoteImageUrl, verifyBoardImageBytes, type VerifiedBoardImage } from "./board-content-adapter";

export type BoardImageRequest = { source: File | string; point: { x: number; y: number }; targetId?: string; targetState?: string };
export function boardImageErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "IMAGE_DECODE_FAILED";
  if (code === "IMAGE_ACCESS_DENIED") return "无法保存图片：白板访问权限已改变。";
  if (code === "IMAGE_TOO_LARGE") return "图片超过 25MB，未添加。";
  if (code === "IMAGE_MAGIC_INVALID") return "图片内容与声明格式不一致，未添加。";
  if (code === "IMAGE_ASSET_UNAVAILABLE") return "图片未保存，请检查网络后重试。";
  if (code === "IMAGE_FORMAT_INVALID") return "请选择 JPG、PNG、WEBP、GIF 或 SVG 文件。";
  if (code === "IMAGE_TARGET_UNAVAILABLE") return "原图片已变化或不可编辑。请重新选择替换目标。";
  return "图片未添加。请检查文件、HTTPS 地址或跨域权限后重试。";
}

export function useBoardImageUpload({ blocked, scope, commit, onSuccess }: {
  blocked: boolean;
  scope: unknown;
  commit: (image: VerifiedBoardImage, name: string, request: BoardImageRequest, signal: AbortSignal) => Promise<boolean>;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), mounted = useRef(false), last = useRef<BoardImageRequest | null>(null);
  const current = useRef({ blocked, scope, commit, onSuccess }); current.current = { blocked, scope, commit, onSuccess };
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; if (mounted.current) setBusy(false); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, [cancel]);
  useEffect(() => { if (blocked) cancel(); }, [blocked, cancel]);
  useEffect(() => { cancel(); last.current = null; setError(null); }, [scope, cancel]);
  const upload = useCallback(async (request: BoardImageRequest) => {
    if (current.current.blocked || active.current) return;
    const controller = new AbortController(), capturedScope = current.current.scope; active.current = controller; last.current = request; setBusy(true); setError(null);
    const valid = () => mounted.current && current.current.scope === capturedScope && active.current === controller && !controller.signal.aborted && !current.current.blocked;
    try {
      const remote = typeof request.source === "string";
      if (!remote && !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test((request.source as File).type)) throw new Error("IMAGE_FORMAT_INVALID");
      const image = remote ? await inspectRemoteImageUrl(request.source as string, (...args) => globalThis.fetch(...args), controller.signal) : await verifyBoardImageBytes(request.source as File, (request.source as File).type, undefined, controller.signal);
      if (!valid()) return;
      const name = remote ? new URL((image as VerifiedBoardImage & { url: string }).url).pathname.split("/").pop() || "remote-image" : (request.source as File).name;
      const accepted = await current.current.commit(image, name, request, controller.signal);
      if (!valid()) return;
      if (!accepted) throw new Error("IMAGE_COMMIT_REJECTED");
      last.current = null; current.current.onSuccess();
    } catch (cause) { if (valid()) setError(boardImageErrorMessage(cause)); }
    finally { if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false); } }
  }, []);
  const retry = useCallback(() => { if (last.current) void upload(last.current); }, [upload]);
  const clear = useCallback(() => { cancel(); last.current = null; setError(null); }, [cancel]);
  return { busy, error, upload, retry, clear, cancel };
}
