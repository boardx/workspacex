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

export type BoardImageUploadItem = { id: number; name: string; status: "queued" | "uploading" | "succeeded" | "failed" | "cancelled"; error: string | null };
type PendingImage = BoardImageUploadItem & { request: BoardImageRequest };

export function useBoardImageUpload({ blocked, scope, commit, onSuccess }: {
  blocked: boolean;
  scope: unknown;
  commit: (image: VerifiedBoardImage, name: string, request: BoardImageRequest, signal: AbortSignal) => Promise<boolean>;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [items, setItems] = useState<BoardImageUploadItem[]>([]);
  const active = useRef<AbortController | null>(null), mounted = useRef(false), batch = useRef<PendingImage[]>([]), nextId = useRef(0);
  const current = useRef({ blocked, scope, commit, onSuccess }); current.current = { blocked, scope, commit, onSuccess };
  const publish = useCallback(() => { if (mounted.current) setItems(batch.current.map(({ id, name, status, error }) => ({ id, name, status, error }))); }, []);
  const cancel = useCallback(() => {
    active.current?.abort(); active.current = null;
    batch.current.forEach(item => { if (item.status === "queued" || item.status === "uploading") item.status = "cancelled"; });
    publish(); if (mounted.current) setBusy(false);
  }, [publish]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, [cancel]);
  useEffect(() => { if (blocked) cancel(); }, [blocked, cancel]);
  useEffect(() => { cancel(); batch.current = []; setItems([]); setError(null); }, [scope, cancel]);
  const run = useCallback(async (pending: PendingImage[]) => {
    if (current.current.blocked || active.current || !pending.length) return;
    const controller = new AbortController(), capturedScope = current.current.scope, capturedBatch = batch.current;
    active.current = controller; setBusy(true); setError(null);
    const valid = () => mounted.current && current.current.scope === capturedScope && batch.current === capturedBatch && active.current === controller && !controller.signal.aborted && !current.current.blocked;
    try {
      for (const item of pending) {
        if (!valid()) break;
        item.status = "uploading"; item.error = null; publish();
        const request = item.request;
        try {
          const remote = typeof request.source === "string";
          if (!remote && !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test((request.source as File).type)) throw new Error("IMAGE_FORMAT_INVALID");
          const image = remote ? await inspectRemoteImageUrl(request.source as string, (...args) => globalThis.fetch(...args), controller.signal) : await verifyBoardImageBytes(request.source as File, (request.source as File).type, undefined, controller.signal);
          if (!valid()) break;
          const name = remote ? new URL((image as VerifiedBoardImage & { url: string }).url).pathname.split("/").pop() || "remote-image" : (request.source as File).name;
          const accepted = await current.current.commit(image, name, request, controller.signal);
          if (!valid()) break;
          if (!accepted) throw new Error("IMAGE_COMMIT_REJECTED");
          item.status = "succeeded";
        } catch (cause) {
          if (!valid()) break;
          item.status = "failed"; item.error = boardImageErrorMessage(cause);
          // Server denial may arrive before the editor's role update. Stop the
          // queue immediately instead of uploading more files under stale UI ACL.
          if (cause instanceof Error && cause.message === "IMAGE_ACCESS_DENIED") {
            capturedBatch.forEach(remaining => { if (remaining.status === "queued") remaining.status = "cancelled"; });
            publish(); break;
          }
        }
        publish();
      }
      if (valid()) {
        const failed = capturedBatch.filter(item => item.status === "failed");
        setError(failed.length ? failed.length === 1 ? failed[0]!.error : `${failed.length} 张图片未添加，已添加的图片会保留。` : null);
        if (capturedBatch.every(item => item.status === "succeeded")) current.current.onSuccess();
      }
    } finally { if (active.current === controller) { active.current = null; if (mounted.current) setBusy(false); } }
  }, [publish]);
  const uploadBatch = useCallback(async (requests: readonly BoardImageRequest[]) => {
    if (current.current.blocked || active.current || !requests.length) return;
    // A replacement always targets one image. Do not replace it repeatedly from a multi-file drop.
    const selected = requests.some(request => request.targetId) ? requests.slice(0, 1) : requests;
    const seen = new Set<File | string>();
    batch.current = selected.filter(request => { if (seen.has(request.source)) return false; seen.add(request.source); return true; }).map(request => ({ id: ++nextId.current, name: typeof request.source === "string" ? request.source : request.source.name, status: "queued" as const, error: null, request: { ...request, point: { ...request.point } } }));
    publish(); await run(batch.current);
  }, [publish, run]);
  const upload = useCallback((request: BoardImageRequest) => uploadBatch([request]), [uploadBatch]);
  const retry = useCallback(() => { void run(batch.current.filter(item => item.status === "failed")); }, [run]);
  const clear = useCallback(() => { cancel(); batch.current = []; setItems([]); setError(null); }, [cancel]);
  return { busy, error, items, upload, uploadBatch, retry, clear, cancel };
}
