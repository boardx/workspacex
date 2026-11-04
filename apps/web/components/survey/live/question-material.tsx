"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
import { displaySurveyMessage, type SurveyDisplayMessage } from "@/lib/survey/display-message";
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
  const { t, locale } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<SurveyDisplayMessage | null>(null);
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
        { key: "survey.design.fileTooLarge", params: { max: Math.round(maxBytes / 1024 / 1024) } },
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    setPending(file);
    try {
      const asset = await upload(file, questionId);
      setNames((current) => ({ ...current, [asset.id]: asset.name }));
      onChange([...value, asset.id]);
      setPending(undefined);
    } catch {
      setError({ key: "survey.design.uploadFailed" });
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
      setError({ key: "survey.design.signatureRequired" });
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
      else setError({ key: "survey.design.signatureFailed" });
    }, "image/png");
  }
  return (
    <div className="space-y-3">
      {!upload && (
        <p className="text-12 text-muted-foreground">{t("survey.design.materialPreview")}</p>
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
            aria-label={t("survey.design.signatureCanvas")}
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
            {t("survey.design.typeSignature")}
            <Input
              aria-label={t("survey.design.typeSignature")}
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
              {t("survey.design.clearSignature")}
            </Button>
            <Button
              type="button"
              disabled={!upload || busy || !!value.length}
              onClick={saveSignature}
            >
              {t("survey.design.saveSignature")}
            </Button>
          </div>
        </>
      ) : (
        <label className="block text-12">
          {t("survey.design.chooseFile")}
          <Input
            type="file"
            aria-label={t("survey.design.chooseFile")}
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
          {t("survey.design.uploading")}
        </p>
      )}
      {error && (
        <div role="alert" className="text-12 text-destructive">
          {displaySurveyMessage(error, t, locale)}
          {pending && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void send(pending)}
            >
              {t("survey.design.retryUpload")}
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
            <span className="break-all">{names[id] ?? t("survey.design.uploadedMaterial")}</span>
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
                  setError({ key: "survey.design.removeFailed" });
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              {t("survey.design.deleteMaterial")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
