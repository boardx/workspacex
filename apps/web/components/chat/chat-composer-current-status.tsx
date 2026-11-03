"use client";
import { useI18n } from "@/lib/i18n/provider";
import { AlertTriangle, Check, Loader2, Pause } from "lucide-react";
import { ComposerStatusBar, voiceErrorStatus } from "./chat-composer-status-bar";
import { formatElapsed } from "./chat-composer-voice-control";
import { SILENCE_AUTO_PAUSE_AFTER_SECONDS, type ComposerVoiceSession } from "@/lib/use-composer-voice-session";
import type { useAsrDraft } from "@/lib/use-asr-draft";

/** Presentation of the existing recording/upload state; never owns recording lifecycle. */
export function ChatComposerCurrentStatus({ voice, speech, hasUploading, archived }: {
  voice: ComposerVoiceSession; speech: ReturnType<typeof useAsrDraft>; hasUploading: boolean; archived: boolean;
}): JSX.Element | null {
  const { locale, t } = useI18n();
    const chars = voice.transcribedChars;
    if (voice.phase === "connecting") {
      return (
        <ComposerStatusBar tone="neutral" testId="chat-mic-connecting" icon={<Loader2 className="h-4 w-4 animate-spin" />}
          title={t("chatComposer.voiceConnecting")} description={t("chatComposer.voiceConnectingHint")}
          actions={[{ label: t("common.cancel"), onClick: voice.discard, testId: "chat-task-workbench-composer-recording-cancel" }]} />
      );
    }
    if (voice.phase === "listening" && voice.silenceHint) {
      return (
        <ComposerStatusBar tone="warning" testId="chat-mic-listening" icon={<AlertTriangle className="h-4 w-4" />}
          title={t("chatComposer.voiceSilent", { seconds: voice.silentSeconds })}
          description={t("chatComposer.voiceSilentHint") + (voice.autoPause ? t("chatComposer.voiceAutoPauseHint", { seconds: SILENCE_AUTO_PAUSE_AFTER_SECONDS }) : "")}
          actions={[
            { label: t("chatComposer.changeMicrophone"), onClick: voice.requestDeviceMenu, testId: "chat-task-workbench-composer-mic-switch-device" },
            { label: t("chatComposer.stop"), onClick: voice.finish, variant: "solid-destructive", testId: "chat-task-workbench-composer-recording-confirm" },
          ]} />
      );
    }
    if (voice.phase === "listening") {
      return (
        <ComposerStatusBar tone="destructive" testId="chat-mic-listening"
          icon={<span className="h-2 w-2 animate-pulse rounded-pill bg-destructive" />}
          title={t("chatComposer.voiceListening", { elapsed: formatElapsed(voice.totalSeconds) })}
          description={t("chatComposer.voiceListeningHint", { count: chars })}
          actions={[
            { label: t("chatComposer.pause"), onClick: voice.pause, testId: "chat-task-workbench-composer-recording-pause" },
            { label: t("chatComposer.stop"), onClick: voice.finish, variant: "solid-destructive", testId: "chat-task-workbench-composer-recording-confirm" },
          ]} />
      );
    }
    if (voice.phase === "stopping") {
      return (
        <ComposerStatusBar tone="neutral" testId="chat-mic-stopping" icon={<Loader2 className="h-4 w-4 animate-spin" />}
          title={t("chatComposer.voiceStopping")} description={t("chatComposer.voiceStoppingHint")} />
      );
    }
    if (voice.phase === "paused") {
      return (
        <ComposerStatusBar tone="neutral" testId="chat-task-workbench-composer-paused" icon={<Pause className="h-4 w-4" />}
          title={t("chatComposer.voicePaused", { elapsed: formatElapsed(voice.totalSeconds) })}
          description={t("chatComposer.voicePausedHint", { count: chars })}
          actions={[
            { label: t("chatComposer.discard"), onClick: voice.discard, testId: "chat-task-workbench-composer-recording-cancel" },
            { label: t("chatComposer.continue"), onClick: voice.start, testId: "chat-task-workbench-composer-recording-resume" },
            { label: t("chatComposer.done"), onClick: voice.finish, variant: "solid", testId: "chat-task-workbench-composer-recording-confirm" },
          ]} />
      );
    }
    if (voice.phase === "error") {
      // 说什么、给不给「重试」：与另一处 composer 共用 `voiceErrorStatus`（chat-composer-status-bar.tsx）。
      const bar = voiceErrorStatus(speech, { onRetry: voice.start, retryTestId: "chat-task-workbench-composer-mic-retry", helpTestId: "chat-task-workbench-composer-mic-permission-help" }, locale);
      return (
        <ComposerStatusBar tone="warning" testId="chat-mic-error" icon={<AlertTriangle className="h-4 w-4" />}
          title={bar.title} description={bar.description} actions={bar.actions} />
      );
    }
    if (voice.phase === "done") {
      return (
        <ComposerStatusBar tone="success" testId="chat-task-workbench-composer-transcribed" icon={<Check className="h-4 w-4" />}
          title={t("chatComposer.voiceTranscribed", { count: chars })} description={t("chatComposer.voiceTranscribedHint")}
          actions={[
            { label: t("chatComposer.undoTranscription"), onClick: voice.undo, testId: "chat-task-workbench-composer-recording-undo" },
            { label: t("chatComposer.speakAgain"), onClick: voice.start, testId: "chat-task-workbench-composer-recording-resume" },
          ]} />
      );
    }
    /*
     * 2026-09-03 人类直接反馈「composer 下面的那行状态是多余的」——`agent.isRunning`
     * 这一态此前在这里画一整条状态栏（"Agent 正在处理上一条消息" + 「停止生成」）,
     * 与已经存在的两处提示重复：① 发送按钮本身在运行中会原地换成「停止」方形按钮
     * （下方 `agent.isRunning` 分支,同一个「停止生成」动作,同一个位置更符合直觉）；
     * ② 页脚禁用理由行（`sendDisabledReason`）本就把这一态排除在外
     * （`&& !agent.isRunning`），设计意图正是"运行中不需要再单独喊一遍"。三处一起
     * 出现是真正的信息重复,不是三种不同的信号——删掉这里，功能（停止生成）原样保留
     * 在发送按钮位置，不是砍掉能力，只是不再重复说三遍。
     */
    if (hasUploading && !archived) {
      return (
        <ComposerStatusBar tone="neutral" testId="chat-task-workbench-composer-uploading" icon={<Loader2 className="h-4 w-4 animate-spin" />}
          title={t("chatComposer.uploading")} description={t("chatComposer.uploadingHint")} />
      );
    }
    return null;

}
