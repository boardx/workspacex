"use client";
import * as React from "react";

/**
 * 摄取复核的权威状态（D-U11 裁决 B）——摄取抽屉是权威入口，独立复核屏是同一动作的
 * 批量视图，两处读写这同一份状态。
 *
 * ⚠ 为什么用模块级 store 而不是 files-app 的 useState：抽屉与复核屏在不同 URL / 不同
 *   挂载点先后出现（抽屉是 browser 模式的叠层，复核屏是 review 模式的整屏）。把状态挂在
 *   模块级、用 useSyncExternalStore 订阅，才能保证「在抽屉里接受一条，复核屏里那条立刻
 *   变态」——它们指向同一个 artifact_id，不是各自的本地副本。
 *   （预览用切屏是 <a> 全量导航，会重置内存；这是原型限制，真实系统由服务端持久化。）
 */

export type ReviewDisposition = "accepted" | "rejected";

type Snapshot = Readonly<Record<string, ReviewDisposition>>;

const EMPTY: Snapshot = Object.freeze({});
let state: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Snapshot {
  return state;
}

/** 处置某个 artifact（接受 / 拒绝）。两处入口都调它，写同一份。 */
export function resolveReview(artifactId: string, disposition: ReviewDisposition) {
  if (state[artifactId] === disposition) return;
  state = Object.freeze({ ...state, [artifactId]: disposition });
  emit();
}

export function useReviewState() {
  const dispositions = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { dispositions, resolve: resolveReview };
}
