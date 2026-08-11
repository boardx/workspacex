// @vitest-environment jsdom
//
// use-audio-input-devices.test.ts — realtime-asr 增补 A（contract.md §7.3）的反证。
//
// 这里证的是三条诚实约束真的成立、且**能被造反证推翻**：
//  - 记住选择（localStorage），但记的是 id；
//  - 记住的 id 若已不在当前列表 → 退化系统默认（不卡在幽灵设备上）；
//  - devicechange → 重新枚举。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  MIC_DEVICE_STORAGE_KEY,
  useAudioInputDevices,
} from "@/lib/use-audio-input-devices";

const listeners = new Map<string, Set<() => void>>();

beforeEach(() => {
  window.localStorage.clear();
  listeners.clear();
  // 一套可控的 mediaDevices.devicechange 事件总线。
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      addEventListener: (type: string, cb: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(cb);
      },
      removeEventListener: (type: string, cb: () => void) => { listeners.get(type)?.delete(cb); },
    },
  });
});

afterEach(() => { vi.restoreAllMocks(); });

function fireDeviceChange() {
  for (const cb of listeners.get("devicechange") ?? []) cb();
}

describe("§7.3 输入设备选择状态", () => {
  it("挂载即枚举一次；devicechange 时再枚举（热插拔刷新）", async () => {
    const enumerate = vi.fn()
      .mockResolvedValueOnce([{ deviceId: "a", label: "麦A" }])
      .mockResolvedValueOnce([{ deviceId: "a", label: "麦A" }, { deviceId: "b", label: "麦B" }]);
    const { result } = renderHook(() => useAudioInputDevices({ enumerate }));

    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    act(() => fireDeviceChange());
    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(enumerate).toHaveBeenCalledTimes(2);
  });

  it("选择写入 localStorage（记的是 id）；选“系统默认”清掉键", async () => {
    const enumerate = vi.fn().mockResolvedValue([{ deviceId: "a", label: "麦A" }]);
    const { result } = renderHook(() => useAudioInputDevices({ enumerate }));
    await waitFor(() => expect(result.current.devices).toHaveLength(1));

    act(() => result.current.select("a"));
    expect(window.localStorage.getItem(MIC_DEVICE_STORAGE_KEY)).toBe("a");
    expect(result.current.selectedDeviceId).toBe("a");

    act(() => result.current.select(null));
    expect(window.localStorage.getItem(MIC_DEVICE_STORAGE_KEY)).toBeNull();
    expect(result.current.selectedDeviceId).toBeNull();
  });

  it("反证：记住的 id 在当前列表里已不存在 → 退化系统默认（null），不把幽灵 id 传下去", async () => {
    window.localStorage.setItem(MIC_DEVICE_STORAGE_KEY, "ghost");
    const enumerate = vi.fn().mockResolvedValue([{ deviceId: "a", label: "麦A" }]);
    const { result } = renderHook(() => useAudioInputDevices({ enumerate }));
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    expect(result.current.selectedDeviceId, "幽灵 id 不该生效").toBeNull();
  });

  it("列表还没列出来时不清掉记忆——那时“不存在”只是“还不知道”", async () => {
    window.localStorage.setItem(MIC_DEVICE_STORAGE_KEY, "a");
    // 永远 pending 的枚举：devices 保持空
    const enumerate = vi.fn(() => new Promise<never>(() => {}));
    const { result } = renderHook(() => useAudioInputDevices({ enumerate }));
    // devices 为空时记忆仍然保留（不因“列表空”就抹掉用户选择）
    expect(result.current.selectedDeviceId).toBe("a");
  });
});
