// @vitest-environment jsdom
//
// 个人设置"每次都先给我看计划"（issue #2667）——覆盖：
//  - 默认关闭（未设置过时，读回 false）；
//  - 能读能写能持久化（`localStorage`，与 `lib/theme.ts` 同一套模式）；
//  - hook 挂载时从存储同步一次初始值，`setAlwaysPlanFirst`/`toggleAlwaysPlanFirst`
//    同时更新 state 与存储，两者不会不同步。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  ALWAYS_PLAN_FIRST_STORAGE_KEY,
  getStoredAlwaysPlanFirst,
  setStoredAlwaysPlanFirst,
  useAlwaysPlanFirstSetting,
} from "@/lib/chat-always-plan-first-setting";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("getStoredAlwaysPlanFirst / setStoredAlwaysPlanFirst", () => {
  it("从未设置过时默认关闭（验收标准②：默认体验是自动判类）", () => {
    expect(getStoredAlwaysPlanFirst()).toBe(false);
  });

  it("写入后能原样读回", () => {
    setStoredAlwaysPlanFirst(true);
    expect(getStoredAlwaysPlanFirst()).toBe(true);
    expect(window.localStorage.getItem(ALWAYS_PLAN_FIRST_STORAGE_KEY)).toBe("true");

    setStoredAlwaysPlanFirst(false);
    expect(getStoredAlwaysPlanFirst()).toBe(false);
  });
});

describe("useAlwaysPlanFirstSetting", () => {
  it("挂载时从存储同步初始值", async () => {
    setStoredAlwaysPlanFirst(true);
    const { result } = renderHook(() => useAlwaysPlanFirstSetting());
    await waitFor(() => expect(result.current.alwaysPlanFirst).toBe(true));
  });

  it("setAlwaysPlanFirst 同时更新 state 与持久化存储", async () => {
    const { result } = renderHook(() => useAlwaysPlanFirstSetting());
    await waitFor(() => expect(result.current.alwaysPlanFirst).toBe(false));

    act(() => result.current.setAlwaysPlanFirst(true));
    expect(result.current.alwaysPlanFirst).toBe(true);
    expect(getStoredAlwaysPlanFirst()).toBe(true);
  });

  it("toggleAlwaysPlanFirst 翻转当前值", async () => {
    const { result } = renderHook(() => useAlwaysPlanFirstSetting());
    await waitFor(() => expect(result.current.alwaysPlanFirst).toBe(false));

    act(() => result.current.toggleAlwaysPlanFirst());
    expect(result.current.alwaysPlanFirst).toBe(true);
    expect(getStoredAlwaysPlanFirst()).toBe(true);

    act(() => result.current.toggleAlwaysPlanFirst());
    expect(result.current.alwaysPlanFirst).toBe(false);
    expect(getStoredAlwaysPlanFirst()).toBe(false);
  });

  it("一个组件写入后，新挂载的另一个组件能读到持久化后的值", async () => {
    const first = renderHook(() => useAlwaysPlanFirstSetting());
    await waitFor(() => expect(first.result.current.alwaysPlanFirst).toBe(false));
    act(() => first.result.current.setAlwaysPlanFirst(true));

    const second = renderHook(() => useAlwaysPlanFirstSetting());
    await waitFor(() => expect(second.result.current.alwaysPlanFirst).toBe(true));
  });
});
