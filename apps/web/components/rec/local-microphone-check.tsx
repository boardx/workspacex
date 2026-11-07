"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { useLocalMicrophoneCheck } from "./use-local-microphone-check";

export function LocalMicrophoneCheck({ deviceId, onClose }: { deviceId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const check = useLocalMicrophoneCheck(deviceId);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const audio = audioRef.current;
    return () => { if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); } };
  }, [check.previewUrl]);
  const active = check.state === "requesting" || check.state === "recording" || check.state === "stopping";
  const status = check.state === "error"
    ? t(check.error === "permission-denied" ? "rec.micCheck.permission" : "rec.micCheck.failed")
    : check.state === "idle" ? null : t(`rec.micCheck.${check.state}`);
  return <section aria-label={t("rec.micCheck.title")} className="rounded-card border border-border bg-card p-4" data-testid="rec-local-check">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-16 font-semibold">{t("rec.micCheck.title")}</h2>
      <Button type="button" size="sm" variant="ghost" onClick={() => { void check.clear(); onClose(); }}>{t("rec.micCheck.close")}</Button>
    </div>
    <p className="mt-2 text-12 text-muted-foreground">{t("rec.micCheck.privacy")}</p>
    <p className="mt-1 text-12 text-muted-foreground">{t("rec.micCheck.clearedHint")}</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div role="meter" aria-label={t("rec.workspace.level")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(check.level * 100)}
        className="h-2 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full bg-success transition-[width]" style={{ width: `${Math.round(check.level * 100)}%` }} /></div>
      {!active && <Button type="button" size="sm" onClick={() => void check.start()}>{t("rec.micCheck.start")}</Button>}
      {check.state === "recording" && <Button type="button" size="sm" onClick={() => void check.finish()}>{t("rec.micCheck.finish")}</Button>}
      {active && <Button type="button" size="sm" variant="outline" onClick={() => void check.clear()}>{t("rec.micCheck.cancel")}</Button>}
      {check.previewUrl && <>
        <audio ref={audioRef} aria-label={t("rec.micCheck.playback")} controls src={check.previewUrl} className="max-w-full" />
        <Button type="button" size="sm" variant="outline" onClick={() => void check.clear()}>{t("rec.micCheck.clear")}</Button>
      </>}
    </div>
    {status && <p className={`mt-2 text-12 ${check.state === "error" ? "text-destructive" : "text-muted-foreground"}`} role={check.state === "error" ? "alert" : "status"}>{status}</p>}
  </section>;
}
