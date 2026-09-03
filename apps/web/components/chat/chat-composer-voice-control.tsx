"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, Mic, Square } from "lucide-react";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { AsrDraftStatus } from "@/lib/use-asr-draft";
import type { ComposerVoicePhase } from "@/lib/use-composer-voice-session";

/**
 * 2026-09-02 composer 重设计——**一个按钮承载全部语音状态**的分段胶囊：
 *   语音（描边）→ 连接中（旋转）→ 停止（赭红实底：■ + 音量条 + 计时）→ 继续（赭红描边）
 *   → 出错时「重试」。右侧小箭头是设备菜单（设备列表 + 静音自动暂停开关），
 *   替代此前常驻的「系统默认麦克风」胶囊——默认值不是信息，设备名放到卡片下方页脚。
 *
 * 唯一麦克风入口（TW-P0-5⑤）仍是 `chat-task-workbench-composer-mic`；
 * `data-mic-status` 透传采音 hook 的真实状态，`aria-label` 与状态一一对应（TW-A11Y-6）。
 * 箭头的可访问名刻意不含"麦克风/语音"字样：它是入口的二级菜单，不是第二个入口。
 * 尺寸按设计稿 2x 截图折算：高 32、圆角全、主段左右 14、箭头段宽 28、分隔线 1。
 */

export interface ComposerVoiceDevice {
  readonly deviceId: string;
  readonly label: string;
}

export function describeVoiceDevice(devices: readonly ComposerVoiceDevice[], selectedDeviceId: string | null): string {
  if (selectedDeviceId === null) return "系统默认麦克风";
  const index = devices.findIndex((d) => d.deviceId === selectedDeviceId);
  if (index === -1) return "系统默认麦克风";
  const label = devices[index]!.label;
  return label !== "" ? label : `麦克风 ${index + 1}（授权后显示名称）`;
}

export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const LABEL_BY_STATUS: Record<AsrDraftStatus, string> = {
  idle: "开始语音输入",
  connecting: "正在连接语音识别…",
  listening: "停止语音输入",
  stopping: "正在停止…",
  denied: "开始语音输入",
  unsupported: "开始语音输入",
  error: "开始语音输入",
};

/** 5 根音量条：每根按自己的门槛亮起，高度随 level 平滑变化——读的是真实 RMS。 */
function LevelBars({ level }: { level: number }): JSX.Element {
  const bars = [0.05, 0.15, 0.3, 0.5, 0.7];
  return (
    <span
      aria-hidden
      className="flex h-4 items-end gap-0.5"
      data-testid="chat-task-workbench-composer-recording-level"
      data-level={level.toFixed(3)}
    >
      {bars.map((threshold, i) => {
        const on = level >= threshold;
        const height = on ? Math.min(16, 6 + Math.round(level * 14) + i) : 4;
        return (
          <span
            key={threshold}
            className="w-0.5 rounded-pill bg-destructive-foreground transition-[height] duration-fast"
            style={{ height: `${height}px`, opacity: on ? 1 : 0.45 }}
          />
        );
      })}
    </span>
  );
}

export function ComposerVoiceControl({
  status,
  phase,
  elapsedSeconds,
  level,
  disabled,
  onStart,
  onStop,
  onResume,
  onRequireSession,
  devices,
  selectedDeviceId,
  onSelectDevice,
  autoPause,
  onAutoPauseChange,
  deviceMenuRequest = 0,
}: {
  readonly status: AsrDraftStatus;
  readonly phase: ComposerVoicePhase;
  readonly elapsedSeconds: number;
  readonly level: number;
  readonly disabled: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onResume: () => void;
  readonly onRequireSession: () => boolean;
  readonly devices: readonly ComposerVoiceDevice[];
  readonly selectedDeviceId: string | null;
  readonly onSelectDevice: (deviceId: string | null) => void;
  readonly autoPause: boolean;
  readonly onAutoPauseChange: (on: boolean) => void;
  /** 外部（状态栏「换麦克风」）请求打开设备菜单的计数。 */
  readonly deviceMenuRequest?: number;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useChatPopoverSlot("chat-composer-mic-devices");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lastRequestRef = React.useRef(deviceMenuRequest);
  React.useEffect(() => {
    if (deviceMenuRequest === lastRequestRef.current) return;
    lastRequestRef.current = deviceMenuRequest;
    setMenuOpen(true);
  }, [deviceMenuRequest, setMenuOpen]);
  React.useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, setMenuOpen]);

  const listening = phase === "listening";
  const paused = phase === "paused";
  const busy = phase === "connecting" || phase === "stopping";
  const deviceText = describeVoiceDevice(devices, selectedDeviceId);
  const ariaLabel = paused ? "继续语音输入" : LABEL_BY_STATUS[status];

  const shell = listening
    ? "border-destructive bg-destructive text-destructive-foreground"
    : paused
      ? "border-destructive bg-panel-alt text-destructive"
      : "border-border bg-panel-alt text-card-foreground";
  const divider = listening ? "bg-destructive-foreground/30" : "bg-border";
  const hover = listening ? "hover:bg-destructive/90" : "hover:bg-muted";

  return (
    <div ref={containerRef} className={`relative flex h-8 items-stretch overflow-visible rounded-pill border transition-colors duration-fast ${shell}`}>
      <button
        type="button"
        data-testid="chat-task-workbench-composer-mic"
        data-mic-status={status}
        data-voice-phase={phase}
        aria-pressed={listening}
        aria-busy={busy}
        aria-label={ariaLabel}
        title={phase === "idle" ? `${ariaLabel}（${deviceText}）` : ariaLabel}
        disabled={disabled || busy}
        onClick={() => {
          if (!onRequireSession()) return;
          if (listening) onStop();
          else if (paused) onResume();
          else onStart();
        }}
        className={`flex items-center gap-2 rounded-l-pill pl-3.5 pr-3 text-13 font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground ${hover}`}
      >
        {busy ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : listening ? (
          <Square aria-hidden className="h-3 w-3 fill-current" />
        ) : (
          <Mic aria-hidden className="h-4 w-4" />
        )}
        <span>
          {phase === "connecting" ? "连接中"
            : phase === "stopping" ? "停止中"
            : listening ? "停止"
            : paused ? "继续"
            : phase === "error" ? "重试"
            : "语音"}
        </span>
        {listening ? <LevelBars level={level} /> : null}
        {listening || paused ? (
          <span className="font-mono tabular-nums" data-testid="chat-task-workbench-composer-recording-timer">
            {formatElapsed(elapsedSeconds)}
          </span>
        ) : null}
      </button>
      <span aria-hidden className={`my-1.5 w-px ${divider}`} />
      <button
        type="button"
        data-testid="chat-task-workbench-composer-mic-devices"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="输入设备与录音选项"
        title={`输入设备：${deviceText}`}
        disabled={disabled}
        onClick={() => setMenuOpen((v) => !v)}
        className={`flex w-7 items-center justify-center rounded-r-pill transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground ${hover}`}
      >
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          aria-label="输入设备与录音选项"
          data-testid="chat-task-workbench-composer-mic-devices-listbox"
          className="absolute bottom-full right-0 z-20 mb-1.5 w-64 rounded-lg border border-border bg-popover p-1 text-card-foreground shadow-md"
        >
          <p className="px-2 pb-1 pt-1.5 text-10 text-muted-foreground">输入设备{listening ? "（录音中不可切换）" : ""}</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selectedDeviceId === null}
            disabled={listening || busy}
            onClick={() => { onSelectDevice(null); setMenuOpen(false); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-fast hover:bg-muted disabled:text-disabled-foreground"
          >
            <Check aria-hidden className={`h-3 w-3 shrink-0 ${selectedDeviceId === null ? "" : "invisible"}`} />
            <span className="truncate">系统默认麦克风</span>
          </button>
          {devices.map((device, index) => (
            <button
              key={device.deviceId}
              type="button"
              role="menuitemradio"
              aria-checked={device.deviceId === selectedDeviceId}
              disabled={listening || busy}
              onClick={() => { onSelectDevice(device.deviceId); setMenuOpen(false); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-fast hover:bg-muted disabled:text-disabled-foreground"
            >
              <Check aria-hidden className={`h-3 w-3 shrink-0 ${device.deviceId === selectedDeviceId ? "" : "invisible"}`} />
              <span className="truncate">{device.label !== "" ? device.label : `麦克风 ${index + 1}（授权后显示名称）`}</span>
            </button>
          ))}
          <div aria-hidden className="my-1 h-px bg-border-subtle" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={autoPause}
            data-testid="chat-task-workbench-composer-mic-silence-autopause"
            onClick={() => onAutoPauseChange(!autoPause)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-fast hover:bg-muted"
          >
            <Check aria-hidden className={`h-3 w-3 shrink-0 ${autoPause ? "" : "invisible"}`} />
            <span className="min-w-0 flex-1 truncate">静音自动暂停</span>
            <span className="text-10 text-muted-foreground">静音 13 秒后</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
