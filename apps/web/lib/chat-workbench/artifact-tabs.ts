/**
 * 右栏里同时开着的几份结果 —— 「打开 / 切换 / 关闭」这三件事的判据。
 *
 * ## 为什么需要它（2026-09-23，R2 复盘清单第 3、7 件）
 *
 * R2 把结果从模态搬进了右栏，但**一次只能看一份**：看完 A 要看 B，得先返回列表、
 * 再在列表里找到 B。追问过程里来回切两三次，就是六到八次点击，而且每次都要重新
 * 在列表里用眼睛找——列表长起来之后这件事只会更糟。Claude Code / Codex 在这里的
 * 姿势是**同时开着几份、在它们之间切**，切换成本是一次点击。
 *
 * 判据单独成源是因为它全是边界：满了淘汰谁、关掉当前这份之后该落到哪一份、
 * 重复打开同一份要不要开第二个。这些在组件里写成内联三元表达式没人能验。
 */

import type { ListThreadArtifactsOut } from "@/lib/live-chat";

export type ArtifactTab = ListThreadArtifactsOut["items"][number];

/**
 * 同时最多开几份。
 *
 * 右栏最窄可以被拖到 240px（`PANEL_WIDTH_MIN`），页签条再多就只剩省略号，
 * 认不出哪个是哪个——那时「开着」等于没开。4 份是这个宽度下还能各自留出
 * 可辨认字数的上限。
 */
export const ARTIFACT_TAB_LIMIT = 4;

export interface ArtifactTabState {
  readonly tabs: readonly ArtifactTab[];
  /** 当前显示的那一份在 `tabs` 里的下标；`tabs` 为空时是 -1。 */
  readonly activeIndex: number;
}

export const EMPTY_ARTIFACT_TABS: ArtifactTabState = { tabs: [], activeIndex: -1 };

/** 当前显示的那一份；没有就是 `null`。 */
export function activeTab(state: ArtifactTabState): ArtifactTab | null {
  return state.tabs[state.activeIndex] ?? null;
}

/**
 * 打开一份结果。
 *
 * - 已经开着 ⇒ **切过去**，不开第二个。同一份产物开两个页签，用户分不出两者有什么
 *   区别，关掉一个还会以为没关掉。
 * - 没开过且已满 ⇒ 淘汰**最早打开的那一份**（下标 0）。不淘汰「最久没看的那一份」：
 *   那需要另记一份访问时间，而用户对「最早开的」有直觉，对 LRU 没有。
 */
export function openTab(state: ArtifactTabState, item: ArtifactTab): ArtifactTabState {
  const existing = state.tabs.findIndex((tab) => tab.artifactId === item.artifactId);
  if (existing !== -1) return { tabs: state.tabs, activeIndex: existing };
  const kept = state.tabs.length >= ARTIFACT_TAB_LIMIT ? state.tabs.slice(1) : state.tabs;
  const tabs = [...kept, item];
  return { tabs, activeIndex: tabs.length - 1 };
}

/**
 * 关掉一份。
 *
 * 关掉的**不是**当前这份时，当前这份必须还是当前这份——按 id 重新定位，
 * 不是拿下标去加减：下标在删除后会整体左移，用旧下标会静默切到隔壁那一份。
 *
 * 关掉的**是**当前这份时，落到它右边那一份；它已经是最后一份就落到左边。
 * 这与浏览器标签页一致，用户不用学新规则。
 */
export function closeTab(state: ArtifactTabState, artifactId: string): ArtifactTabState {
  const index = state.tabs.findIndex((tab) => tab.artifactId === artifactId);
  if (index === -1) return state;
  const tabs = state.tabs.filter((_, i) => i !== index);
  if (tabs.length === 0) return EMPTY_ARTIFACT_TABS;
  if (index !== state.activeIndex) {
    const current = state.tabs[state.activeIndex];
    const moved = current === undefined
      ? -1
      : tabs.findIndex((tab) => tab.artifactId === current.artifactId);
    return { tabs, activeIndex: moved === -1 ? 0 : moved };
  }
  return { tabs, activeIndex: Math.min(index, tabs.length - 1) };
}

/** 切到某一份；不在里面就原样返回（不静默打开它）。 */
export function activateTab(state: ArtifactTabState, artifactId: string): ArtifactTabState {
  const index = state.tabs.findIndex((tab) => tab.artifactId === artifactId);
  return index === -1 ? state : { tabs: state.tabs, activeIndex: index };
}
