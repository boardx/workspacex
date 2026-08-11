/**
 * use-audio-input-devices.ts —— realtime-asr 增补 A（contract.md §7）：
 * composer 麦克风的**输入设备选择**状态。
 *
 * 这份 hook 只管三件事，对应 §7.3 三条诚实约束：
 *  1. 列设备（`enumerateInputDevices`，label 未授权时为空 → UI 显示占位）；
 *  2. 记住选择（`localStorage['wsx.micDeviceId']`，记的是 **id**，不是设备对象）；
 *  3. 热插拔刷新（监听 `mediaDevices.devicechange`）。
 *
 * **它不碰采音、不碰 WS**——选中的 `deviceId` 交给 `useAsrDraft({ deviceId })`，
 * 由 `startCapture` 在真正开始录音那一刻用（§7.1）。这条边界是刻意的：设备**选择**
 * 是纯 UI 状态，设备**使用**才触达采音层，两者不该揉在一起。
 */
"use client";
import * as React from "react";
import { enumerateInputDevices, type AudioInputDevice } from "./live-recording";

/** localStorage 键（contract.md §7.3-3）。全站唯一，跟随既有 `wsx.` 前缀。 */
export const MIC_DEVICE_STORAGE_KEY = "wsx.micDeviceId";

export interface UseAudioInputDevicesResult {
  /** 可选设备列表；未授权时各项 label 为空串（UI 据此显示占位）。 */
  readonly devices: readonly AudioInputDevice[];
  /**
   * 当前选中的 `deviceId`；`null` = 跟随系统默认设备。
   *
   * ⚠ 记住的 id 若在当前列表里已不存在（设备被拔掉后又清了缓存等），这里**仍返回 `null`
   *   语义的默认**——不把一个幽灵 id 传下去。见下方 `selectedDeviceId` 的推导。
   */
  readonly selectedDeviceId: string | null;
  readonly select: (deviceId: string | null) => void;
  /** 手动重新列一次（一般不用；devicechange 已自动刷新）。 */
  readonly refresh: () => void;
}

function readRemembered(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(MIC_DEVICE_STORAGE_KEY);
}

export interface UseAudioInputDevicesDeps {
  /** 测试注入口：替换真实的设备枚举。 */
  readonly enumerate?: () => Promise<AudioInputDevice[]>;
}

export function useAudioInputDevices(deps: UseAudioInputDevicesDeps = {}): UseAudioInputDevicesResult {
  const [devices, setDevices] = React.useState<readonly AudioInputDevice[]>([]);
  const [remembered, setRemembered] = React.useState<string | null>(() => readRemembered());
  const enumerateRef = React.useRef(deps.enumerate);
  enumerateRef.current = deps.enumerate;

  const refresh = React.useCallback(() => {
    const run = enumerateRef.current ?? (() => enumerateInputDevices());
    void run().then((next) => setDevices(next)).catch(() => setDevices([]));
  }, []);

  React.useEffect(() => {
    refresh();
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.addEventListener) return;
    // 插拔设备 → 重列（§7.3-2）。授权后浏览器也会补发一次，届时 label 才可读。
    const onChange = () => refresh();
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, [refresh]);

  const select = React.useCallback((deviceId: string | null) => {
    setRemembered(deviceId);
    if (typeof window === "undefined") return;
    if (deviceId === null) window.localStorage.removeItem(MIC_DEVICE_STORAGE_KEY);
    else window.localStorage.setItem(MIC_DEVICE_STORAGE_KEY, deviceId);
  }, []);

  /**
   * 记住的 id 只有在**当前真的还存在**时才生效——否则退化为系统默认（§7.3-3）。
   * 这一步是"不卡在幽灵设备上"的关键：设备列表空（未授权、尚未列出）时不做此过滤，
   * 因为那时"不存在"只是"还不知道"，贸然清掉会把用户的选择在每次刷新时抹掉。
   */
  const selectedDeviceId = remembered !== null
    && devices.length > 0
    && !devices.some((device) => device.deviceId === remembered)
    ? null
    : remembered;

  return { devices, selectedDeviceId, select, refresh };
}
