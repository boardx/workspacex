"use client";

import * as React from "react";
import { Check, Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { AsrDraftStatus } from "@/lib/use-asr-draft";

/**
 * issue #2130（TW-P0-5⑤⑥，回指 #2068）—— composer 麦克风的**唯一**入口。
 *
 * ## 这里在解决什么真实缺陷
 *
 * 人类 2026-08-26 审计实测：composer 顶层同时有 `chat-mic-button`（真正的录音开关）
 * 与 `chat-mic-device-select`（`MicDevicePicker`，也带 Mic 图标+文字，与前者并排）——
 * 两个都命中"麦克风语义可交互元素"，读作两个入口。判据要求"设备选择降为语音按钮的
 * 二级菜单"：不是删掉设备选择功能，是把它**收进**这一个组件内部，composer 顶层只留
 * 一个 `data-testid` 含 "mic" 的节点。
 *
 * ## 组件内部结构
 *
 * - 顶层唯一入口：`chat-task-workbench-composer-mic`（同时保留旧 `chat-mic-button`
 *   语义——见下方"为什么复用同一个元素"）。点击 = 开始/停止录音，与此前行为一致。
 * - 录音开始后（`connecting`/`listening`/`stopping`）展开一个挂在按钮下方的小面板，
 *   内含：设备切换（二级菜单，`chat-task-workbench-composer-mic-devices`）、
 *   计时（`chat-task-workbench-composer-recording-timer`）、音量
 *   （`chat-task-workbench-composer-recording-level`，来自真实 PCM 帧的 RMS，
 *   不是伪造动画）、取消（`chat-task-workbench-composer-recording-cancel`，
 *   丢弃这段转录）、确认（`chat-task-workbench-composer-recording-confirm`，
 *   保留转录，等价于旧的"再点一次停止"）。
 *
 * ## 为什么复用同一个元素承载两个 testid 语义，而不是新建一个元素
 *
 * `data-testid` 单值——不能同时是 `chat-mic-button` 又是
 * `chat-task-workbench-composer-mic`。既有 4 个 spec
 * （`copilotkit-v2-voice-input.spec.ts`/`copilotkit-v2-persona-archived.spec.ts`/
 * `chat-behavior-shots.spec.ts`/`chat-main-shots.spec.ts`）与 1 个组件测试
 * （`copilotkit-v2-persona-archived.test.tsx`）依赖 `chat-mic-button`。这里做的是
 * **重命名**（同一个按钮、同一个行为，只是 testid 换了），随手把那 5 个调用点
 * 一并改成新名字——不是新增第二个按钮伪装成"消掉了一个"，那样反而是本仓明确禁止的
 * 「点了没有真实差异的假去重」。
 */

export interface ComposerMicDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface ComposerMicControlProps {
  readonly status: AsrDraftStatus;
  readonly listening: boolean;
  readonly connecting: boolean;
  readonly stopping: boolean;
  readonly error: string | null;
  readonly elapsedSeconds: number;
  readonly level: number;
  readonly start: () => void;
  readonly stop: () => void;
  readonly cancel: () => void;
  readonly devices: readonly ComposerMicDevice[];
  readonly selectedDeviceId: string | null;
  readonly onSelectDevice: (deviceId: string | null) => void;
  readonly disabled: boolean;
  readonly onRequireSession: () => boolean;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ComposerMicControl({
  status, listening, connecting, stopping, elapsedSeconds, level,
  start, stop, cancel, devices, selectedDeviceId, onSelectDevice, disabled, onRequireSession,
}: ComposerMicControlProps): JSX.Element {
  const recording = connecting || listening || stopping;
  const [devicesOpen, setDevicesOpen] = useChatPopoverSlot("chat-composer-mic-devices");

  const labelFor = (deviceId: string, label: string, index: number): string =>
    label !== "" ? label : `麦克风 ${index + 1}（授权后显示名称）`;
  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) ?? null;
  const deviceTriggerText = selectedDeviceId === null
    ? "系统默认麦克风"
    : (selectedDevice ? labelFor(selectedDevice.deviceId, selectedDevice.label, devices.indexOf(selectedDevice)) : "系统默认麦克风");

  return (
    <div className="relative flex items-center">
      <Button
        type="button"
        size="icon"
        variant={listening ? "destructive" : "outline"}
        // issue #2130 —— 命名胶囊圆角 token，composer 胶囊类控件本轮统一迁移。
        className="rounded-pill"
        data-testid="chat-task-workbench-composer-mic"
        data-mic-status={status}
        aria-pressed={listening}
        aria-busy={connecting || stopping}
        aria-label={
          connecting ? "正在连接语音识别…"
            : stopping ? "正在停止…"
            : listening ? "停止语音输入" : "开始语音输入"
        }
        title={
          connecting ? "正在连接语音识别…"
            : stopping ? "正在停止…"
            : listening ? "停止语音输入" : "开始语音输入"
        }
        disabled={disabled || connecting || stopping}
        onClick={() => {
          if (!onRequireSession()) return;
          if (listening) stop();
          else start();
        }}
      >
        {connecting || stopping ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Mic aria-hidden className="h-3.5 w-3.5" />
        )}
      </Button>
      {recording ? (
        <div
          className="absolute bottom-9 right-0 z-10 flex w-60 flex-col gap-2 rounded-lg border border-border bg-popover p-2.5 shadow-md"
          data-testid="chat-task-workbench-composer-recording-panel"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-11 text-card-foreground">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${listening ? "animate-pulse bg-destructive" : "bg-muted-foreground"}`} />
              {connecting ? "正在连接…" : stopping ? "正在停止…" : "正在录音"}
            </span>
            <span
              className="font-mono text-11 tabular-nums text-muted-foreground"
              data-testid="chat-task-workbench-composer-recording-timer"
            >
              {formatElapsed(elapsedSeconds)}
            </span>
          </div>
          {/* 真实音量：来自 `useAsrDraft().level`（对真实 PCM 帧求 RMS），不是 CSS 假动画。 */}
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            data-testid="chat-task-workbench-composer-recording-level"
            data-level={level.toFixed(3)}
            role="meter"
            aria-label="音量"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number(level.toFixed(3))}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-fast"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="relative">
              <button
                type="button"
                className="flex items-center gap-1 rounded-pill border border-border-subtle px-2 py-0.5 text-9 text-muted-foreground transition-colors duration-fast hover:bg-muted disabled:bg-disabled disabled:text-disabled-foreground"
                data-testid="chat-task-workbench-composer-mic-devices"
                aria-haspopup="listbox"
                aria-expanded={devicesOpen}
                disabled={listening || connecting || stopping}
                title={`麦克风设备：${deviceTriggerText}（录音中不可切换）`}
                onClick={() => setDevicesOpen((v) => !v)}
              >
                <Mic aria-hidden className="h-2.5 w-2.5" />
                <span className="max-w-24 truncate">{deviceTriggerText}</span>
              </button>
              {devicesOpen ? (
                <div
                  role="listbox"
                  aria-label="选择麦克风"
                  data-testid="chat-task-workbench-composer-mic-devices-listbox"
                  className="absolute bottom-6 left-0 z-20 w-56 rounded-lg border border-border bg-popover p-1 shadow-md"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedDeviceId === null}
                    onClick={() => { onSelectDevice(null); setDevicesOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-11 transition-colors duration-fast hover:bg-muted"
                  >
                    <Check aria-hidden className={`h-3 w-3 shrink-0 ${selectedDeviceId === null ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">系统默认麦克风</span>
                  </button>
                  {devices.map((device, index) => (
                    <button
                      key={device.deviceId}
                      type="button"
                      role="option"
                      aria-selected={device.deviceId === selectedDeviceId}
                      onClick={() => { onSelectDevice(device.deviceId); setDevicesOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-11 transition-colors duration-fast hover:bg-muted"
                    >
                      <Check aria-hidden className={`h-3 w-3 shrink-0 ${device.deviceId === selectedDeviceId ? "opacity-100" : "opacity-0"}`} />
                      <span className="truncate">{labelFor(device.deviceId, device.label, index)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex items-center gap-1 rounded-pill border border-border px-2 py-0.5 text-9 text-muted-foreground transition-colors duration-fast hover:bg-muted disabled:bg-disabled disabled:text-disabled-foreground"
                data-testid="chat-task-workbench-composer-recording-cancel"
                disabled={stopping}
                onClick={() => cancel()}
              >
                <X aria-hidden className="h-2.5 w-2.5" />
                取消
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded-pill bg-primary px-2 py-0.5 text-9 text-primary-foreground transition-colors duration-fast hover:bg-primary/90 disabled:bg-disabled disabled:text-disabled-foreground"
                data-testid="chat-task-workbench-composer-recording-confirm"
                disabled={stopping || connecting}
                onClick={() => stop()}
              >
                <Check aria-hidden className="h-2.5 w-2.5" />
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
