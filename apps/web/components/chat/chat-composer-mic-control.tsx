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
 *   紧挨着它的是设备二级菜单（`chat-task-workbench-composer-mic-devices`，见下面
 *   ⚠ 一节），`idle` 态就能点开——不需要先开始录音。
 * - 录音开始后（`connecting`/`listening`/`stopping`），调用方渲染 `ComposerMicRecordingBar`
 *   ——内含：计时（`chat-task-workbench-composer-recording-timer`）、音量
 *   （`chat-task-workbench-composer-recording-level`，来自真实 PCM 帧的 RMS，
 *   不是伪造动画）、取消（`chat-task-workbench-composer-recording-cancel`，
 *   丢弃这段转录）、确认（`chat-task-workbench-composer-recording-confirm`，
 *   保留转录，等价于旧的"再点一次停止"）。
 *
 * ## 2026-08-30 重设计：录音状态从浮层改成内嵌行（参考 Codex 语音输入体验）
 *
 * 人类反馈：此前 `recording` 态在麦克风按钮正上方弹出一张 `absolute` 定位的悬浮卡片
 * （`bottom-9 right-0`），盖在消息区/输入区上方——视觉上是一个"弹窗"，和 Codex
 * 那种"转录状态就地长在输入区里、不遮挡任何东西"的体验不一样，人类明确要求不用弹窗。
 *
 * 现在拆成两个组件：`ComposerMicControl`（麦克风按钮 + 设备二级菜单，恒定在原位，
 * 不再管理浮层）与 `ComposerMicRecordingBar`（录音时的状态行，由调用方摆在 composer
 * 卡片内部的**正常文档流**里——textarea 下面、工具栏行下面，随内容自然撑高卡片，
 * 不覆盖任何已有内容）。所有 testid 逐字保留（`chat-task-workbench-composer-recording-*`/
 * `chat-task-workbench-composer-mic-devices*`），只换了"浮在上面"为"长在下面"。
 *
 * ⚠ **设备二级菜单必须挂在 `ComposerMicControl`，不能挂在 `ComposerMicRecordingBar`**——
 *   这不是随手选的位置。`ComposerMicRecordingBar` 只在 `connecting/listening/stopping`
 *   三态渲染，而设备菜单本身在这三态下又是 `disabled`（录音中不可切换设备）：
 *   如果把菜单放进状态行，它就变成"渲染出来的每一刻都恰好是禁用的"——用户在任何
 *   状态下都点不开，是个看得见摸不到的假入口。挂在恒定渲染的 `ComposerMicControl`
 *   上，`idle` 态才是它真正可交互的窗口（录音前选好麦克风，`useAsrDraft` 在
 *   **开始录音那一刻**读取一次 `selectedDeviceId`，见其文件头注）。
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
  readonly disabled: boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly onRequireSession: () => boolean;
  readonly devices: readonly ComposerMicDevice[];
  readonly selectedDeviceId: string | null;
  readonly onSelectDevice: (deviceId: string | null) => void;
  /**
   * 2026-08-29 Claude Design 重设计稿——静止态是一颗带"语音"二字的胶囊，不是纯
   * 图标圆钮。默认 `undefined`（不显示文字，逐字节保留此前的纯图标外观）——
   * 这是本仓唯一调用方，但仍然选可选 prop 而不是直接改死：不确定的调用方
   * 比确定的样式更值钱，改死了下一个想要纯图标版本的人只能复制整个组件。
   */
  readonly idleLabel?: string;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function deviceLabelFor(deviceId: string, label: string, index: number): string {
  return label !== "" ? label : `麦克风 ${index + 1}（授权后显示名称）`;
}

/**
 * 唯一的麦克风入口 + 设备二级菜单。恒定在原位——不再持有录音状态行的展示逻辑
 * （见文件头注）。设备菜单必须挂在这里而不是 `ComposerMicRecordingBar`：见文件头注
 * 「设备二级菜单必须挂在 `ComposerMicControl`」一节，`idle` 态是它唯一真正可点开的
 * 窗口，录音中禁用（`useAsrDraft` 只在开始录音那一刻读取一次 deviceId）。
 */
export function ComposerMicControl({
  status, listening, connecting, stopping, start, stop, disabled, onRequireSession, idleLabel,
  devices, selectedDeviceId, onSelectDevice,
}: ComposerMicControlProps): JSX.Element {
  const [devicesOpen, setDevicesOpen] = useChatPopoverSlot("chat-composer-mic-devices");
  const recording = connecting || listening || stopping;

  const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) ?? null;
  const deviceTriggerText = selectedDeviceId === null
    ? "系统默认麦克风"
    : (selectedDevice ? deviceLabelFor(selectedDevice.deviceId, selectedDevice.label, devices.indexOf(selectedDevice)) : "系统默认麦克风");

  return (
    <div className="relative flex items-center gap-1.5">
      <Button
        type="button"
        size={idleLabel !== undefined ? "xs" : "icon"}
        variant={listening ? "destructive" : "outline"}
        // issue #2130 —— 命名胶囊圆角 token，composer 胶囊类控件本轮统一迁移。
        className={idleLabel !== undefined ? "gap-1 rounded-pill" : "rounded-pill"}
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
        {idleLabel !== undefined && !listening && !connecting && !stopping ? <span>{idleLabel}</span> : null}
        {idleLabel !== undefined && listening ? <span>正在听…</span> : null}
      </Button>
      <button
        type="button"
        className="flex items-center gap-1 rounded-pill border border-border-subtle px-2 py-0.5 text-9 text-muted-foreground transition-colors duration-fast hover:bg-muted disabled:bg-disabled disabled:text-disabled-foreground"
        data-testid="chat-task-workbench-composer-mic-devices"
        aria-haspopup="listbox"
        aria-expanded={devicesOpen}
        disabled={disabled || recording}
        title={recording ? `麦克风设备：${deviceTriggerText}（录音中不可切换）` : `麦克风设备：${deviceTriggerText}`}
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
          className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-md"
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
              <span className="truncate">{deviceLabelFor(device.deviceId, device.label, index)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface ComposerMicRecordingBarProps {
  readonly listening: boolean;
  readonly connecting: boolean;
  readonly stopping: boolean;
  readonly elapsedSeconds: number;
  readonly level: number;
  readonly stop: () => void;
  readonly cancel: () => void;
}

/**
 * 录音中的状态行——**内嵌**在 composer 卡片的正常文档流里（调用方把它摆在
 * textarea/工具栏行下面），不是浮层。转录文字本身已经实时写进上面的 textarea
 * （`useAsrDraft` 的 `onTranscript`），这一行只负责"元信息"：在录、多久了、多大声、
 * 要不要留下这段——设备切换在 `ComposerMicControl` 里（原因见文件头注）。
 *
 * `aria-live="polite"` 挂在状态文案（`connecting/listening/stopping` 三段話）
 * 而不是整个容器：计时数字每秒都变，若把 `aria-live` 挂在外层，屏幕阅读器会
 * 每秒重复播报一次"正在录音 00:04""正在录音 00:05"……reading 体验比不播报更糟。
 * 只有状态本身切换（连接→录音→停止）时才需要播报，计时交给用户自己看。
 */
export function ComposerMicRecordingBar({
  listening, connecting, stopping, elapsedSeconds, level, stop, cancel,
}: ComposerMicRecordingBarProps): JSX.Element {
  return (
    <div
      className="flex w-full flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-muted/40 px-2.5 py-1.5"
      data-testid="chat-task-workbench-composer-recording-panel"
      role="status"
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${listening ? "animate-pulse bg-destructive" : "bg-muted-foreground"}`} />
      <span className="shrink-0 text-11 text-card-foreground" aria-live="polite">
        {connecting ? "正在连接…" : stopping ? "正在停止…" : "正在录音"}
      </span>
      <span
        className="shrink-0 font-mono text-11 tabular-nums text-muted-foreground"
        data-testid="chat-task-workbench-composer-recording-timer"
      >
        {formatElapsed(elapsedSeconds)}
      </span>
      {/* 真实音量：来自 `useAsrDraft().level`（对真实 PCM 帧求 RMS），不是 CSS 假动画。 */}
      <div
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted"
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
      <div className="flex shrink-0 items-center gap-1.5">
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
  );
}
