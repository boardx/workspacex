"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export type SurveyUpload = (
  file: File,
  questionId: string,
) => Promise<{ id: string; name: string }>;
export type SurveyRemoveUpload = (
  id: string,
  questionId: string,
) => Promise<void>;
export function QuestionMaterial({
  questionId,
  signature,
  value,
  onChange,
  upload,
  removeUpload,
  accept,
  maxFiles = 1,
  maxBytes,
}: {
  questionId: string;
  signature?: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  upload?: SurveyUpload;
  removeUpload?: SurveyRemoveUpload;
  accept?: string;
  maxFiles?: number;
  maxBytes?: number;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState<File>();
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [typed, setTyped] = React.useState("");
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const drawn = React.useRef(false);
  const lock = React.useRef(false);
  async function send(file: File) {
    if (!upload || lock.current) return;
    if (maxBytes && file.size > maxBytes) {
      setPending(undefined);
      setError(
        `文件超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 上限，请选择较小文件。`,
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setPending(file);
    try {
      const asset = await upload(file, questionId);
      setNames((current) => ({ ...current, [asset.id]: asset.name }));
      onChange([...value, asset.id]);
      setPending(undefined);
    } catch {
      setError("上传失败，文件尚未提交。请重试。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function clear() {
    const element = canvas.current;
    if (element)
      element.getContext("2d")?.clearRect(0, 0, element.width, element.height);
    drawn.current = false;
    setTyped("");
  }
  function saveSignature() {
    const element = canvas.current;
    if (!element || (!typed.trim() && !drawn.current)) {
      setError("请手写或键入签名。");
      return;
    }
    const context = element.getContext("2d");
    if (typed.trim() && context) {
      context.clearRect(0, 0, element.width, element.height);
      context.font = "28px sans-serif";
      context.fillStyle = "#111111";
      context.fillText(typed.trim(), 12, 70, element.width - 24);
    }
    element.toBlob((blob) => {
      if (blob)
        void send(new File([blob], "signature.png", { type: "image/png" }));
      else setError("无法生成签名图片，请重试。");
    }, "image/png");
  }
  return (
    <div className="space-y-3">
      {!upload && (
        <p className="text-12 text-muted-foreground">预览模式不上传文件。</p>
      )}
      {signature ? (
        <>
          <p className="text-12 text-muted-foreground">
            可以手写或键入签名。签名不代表电子合同认证。
          </p>
          <canvas
            ref={canvas}
            width={600}
            height={320}
            aria-label="手写签名画布，也可以使用下方键入签名"
            className="h-auto w-full touch-none rounded-md border border-border bg-white"
            onPointerDown={(event) => {
              if (busy || value.length) return;
              const element = event.currentTarget;
              element.setPointerCapture(event.pointerId);
              drawing.current = true;
              drawn.current = true;
              const rect = element.getBoundingClientRect();
              const ctx = element.getContext("2d");
              ctx?.beginPath();
              ctx?.moveTo(
                ((event.clientX - rect.left) * element.width) / rect.width,
                ((event.clientY - rect.top) * element.height) / rect.height,
              );
            }}
            onPointerMove={(event) => {
              if (!drawing.current) return;
              const element = event.currentTarget,
                rect = element.getBoundingClientRect(),
                ctx = element.getContext("2d");
              if (ctx) {
                ctx.lineWidth = 3;
                ctx.strokeStyle = "#111111";
                ctx.lineTo(
                  ((event.clientX - rect.left) * element.width) / rect.width,
                  ((event.clientY - rect.top) * element.height) / rect.height,
                );
                ctx.stroke();
              }
            }}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerCancel={() => {
              drawing.current = false;
            }}
          />
          <label className="block text-12">
            键入签名
            <Input
              aria-label="键入签名"
              maxLength={80}
              value={typed}
              disabled={busy || !!value.length}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={clear}
            >
              清除签名草稿
            </Button>
            <Button
              type="button"
              disabled={!upload || busy || !!value.length}
              onClick={saveSignature}
            >
              保存签名
            </Button>
          </div>
        </>
      ) : (
        <label className="block text-12">
          选择文件
          <Input
            type="file"
            aria-label="选择文件"
            accept={accept}
            disabled={!upload || busy || value.length >= maxFiles}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {busy && (
        <p role="status" className="text-12">
          正在上传，请稍候…
        </p>
      )}
      {error && (
        <div role="alert" className="text-12 text-destructive">
          {error}
          {pending && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void send(pending)}
            >
              重试上传
            </Button>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {value.map((id) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 text-12"
          >
            <span className="break-all">{names[id] ?? "已上传材料"}</span>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                try {
                  await removeUpload?.(id, questionId);
                  onChange(value.filter((item) => item !== id));
                } catch {
                  setError("删除失败，请重试。");
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              删除材料
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
