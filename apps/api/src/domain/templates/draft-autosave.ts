/**
 * 草稿自动保存的**诚实性**（F18 / `uc-2-1` R7 · E3 · V12）。
 *
 * V12 逐字：**草稿自动保存；显示的最后保存时刻必须真实，不得在保存失败时仍显示已保存**。
 * `usecases.md:85` 补上另一半：`autosavedAt` 必须是**真实写入时刻**，
 * 写失败时必须返回 `AUTOSAVE_FAILED`，界面不得继续显示「已自动保存」。
 *
 * ## 这个模块为什么是一个状态机而不是一个布尔
 *
 * 「保存失败」有两种诚实的收场，本模块**两条都给**，不让调用方二选一地猜：
 *   ① **失败看得见** —— `status: "failed"` 且携带错误码，界面必须渲染它；
 *   ② **草稿不丢**   —— `pendingValue` 原样留着，重试即可，用户不必重打一遍。
 * 少了①，用户以为存上了；少了②，用户看见失败但内容已经没了。两者都不是「诚实」。
 *
 * ## 这里刻意**没有**时钟
 *
 * 本文件**不 import 任何时间源**，`Date.now()` / `new Date()` 一次都不出现——
 * 时刻只能由 `updateDesignFacet` 的响应带进来（契约逐字：**真实写入时刻**，
 * 「不是我们打算保存的时间」）。本地生成的时间戳看起来完全合理，
 * 而它恰恰是 V12 要禁的那种谎：网络已经断了，界面照样每 30 秒刷新一个新鲜时刻。
 * ⇒ `draft-autosave-truthful.test.ts` 有一条断言直接 grep 本文件的源码来钉住这件事。
 */

import type { z } from "zod";
import { templates } from "@repo/contracts";

type TemplateErrorCode = z.infer<typeof templates.TemplateError>;

export type AutosaveStatus = "never-saved" | "saving" | "saved" | "failed";

export interface AutosaveState {
  readonly status: AutosaveStatus;
  /** **服务端**报的最后一次成功写入时刻。⚠ 只在成功时前进，失败时纹丝不动 */
  readonly lastSavedAt: string | null;
  /** 尚未确认落盘的草稿。⚠ 失败时**必须**还在这里——这是「草稿不丢」那一半 */
  readonly pendingValue: string | null;
  /** 非 null ⇒ 界面必须把失败显示出来 */
  readonly failure: TemplateErrorCode | null;
}

export function initialAutosaveState(lastSavedAt: string | null = null): AutosaveState {
  return {
    status: lastSavedAt === null ? "never-saved" : "saved",
    lastSavedAt,
    pendingValue: null,
    failure: null,
  };
}

/** 用户改了字：进入 `saving`。⚠ 上一次的成功时刻保留——它仍然是真的 */
export function beginAutosave(state: AutosaveState, value: string): AutosaveState {
  return { status: "saving", lastSavedAt: state.lastSavedAt, pendingValue: value, failure: null };
}

/**
 * 服务端确认写入。**时刻取自响应**（契约 `updateDesignFacet.out.autosavedAt`）。
 *
 * ⚠ 响应没带时刻（空串）⇒ 按**失败**处理，而不是补一个本地时间：
 * 「存上了但不知道什么时候」在界面上会显示成一个具体到分钟的时刻，那就是编的。
 */
export function autosaveSucceeded(
  state: AutosaveState,
  response: { readonly autosavedAt: string },
): AutosaveState {
  if (response.autosavedAt.trim() === "") return autosaveFailed(state, "AUTOSAVE_FAILED");
  return { status: "saved", lastSavedAt: response.autosavedAt, pendingValue: null, failure: null };
}

/**
 * 写失败。**两件事同时成立**：时刻不前进（①）、草稿留着（②）。
 *
 * ⚠ `pendingValue` 用 `state.pendingValue` 而不是清空：清空会让重试无内容可提交，
 * 于是「保存失败」被降级成「保存失败并且你的字没了」。
 */
export function autosaveFailed(state: AutosaveState, code: TemplateErrorCode): AutosaveState {
  return {
    status: "failed",
    lastSavedAt: state.lastSavedAt,
    pendingValue: state.pendingValue,
    failure: code,
  };
}

/**
 * 界面能不能显示「已自动保存 · <时刻>」。
 *
 * ⚠ 这是 V12 的**可断言面**：失败态恒 false，即使 `lastSavedAt` 还留着一个真时刻——
 * 那个时刻是真的，但把它摆在「已自动保存」四个字后面，说的就不再是真话了。
 */
export function isShowingSaved(state: AutosaveState): boolean {
  return state.status === "saved" && state.lastSavedAt !== null;
}

/** 失败时草稿是否还在（「草稿不丢」那一半的可断言面） */
export function draftRetainedOnFailure(state: AutosaveState): boolean {
  return state.status !== "failed" || state.pendingValue !== null;
}
