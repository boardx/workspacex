/**
 * 流式画布围栏的**渲染取样**——让画布边生成边显示，而不是等 35 秒看一个转圈。
 *
 * ## 为什么需要取样而不是直接跟着 `previewCode`
 * 本地版 4B 大约 30 tok/s，围栏每 30 多毫秒就长一截。`CanvasFabricBody` 的渲染
 * effect 每次变化都 `dispose()` 旧 FabricCanvas 再建一个新的——跟着每个 token 重建
 * 一秒三十次，既卡又闪。
 *
 * ## 取样规则
 * - **闭合后立即跟上**：`closed` 一变 true，返回完整 code，不等任何间隔。终态永远准确。
 * - 未闭合时，只有「内容签名」变了才考虑重画：模型吐的多数 token 是在补某一条便签的
 *   后半句，重画一次看不出差别。签名 = 分区数 + 便签条数 + 表头字段数。
 * - 再加一道最小间隔：签名可能在一秒内连跳几次（一次吐出好几行），间隔把重建频率压住。
 *
 * ## 为什么不在半截内容上判「格式错误」
 * 「还没写到闭合 ```」不是格式错误，是内容还没写完。判错的责任仍然只在闭合之后——
 * 这条是 issue #2298 定下的，本文件只改「什么时候值得重画」，不改「什么时候算错」。
 */

import * as React from "react";

/** 内容签名：只反映「画布上会多出东西」的变化，不反映某条便签正在被补完。 */
export function fenceRenderSignature(code: string): string {
  let sections = 0;
  let bullets = 0;
  let fields = 0;
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) sections += 1;
    else if (line.startsWith("- ") || line.startsWith("* ")) bullets += 1;
    else if (/^[^\s:：][^:：]*[:：]\s*\S/.test(line)) fields += 1;
  }
  return `${sections}/${bullets}/${fields}`;
}

export const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

export interface SampleState {
  /** 上一次真正交出去渲染的 code。 */
  readonly code: string;
  readonly signature: string;
  readonly at: number;
}

/**
 * 纯判定：这一刻该不该把 `next` 交给渲染层。抽成纯函数是为了能直接对
 * 「闭合立即跟上」「签名没变不重画」「间隔没到不重画」三条分别取证，
 * 不用去摆弄计时器。
 */
export function shouldResample(
  prev: SampleState | null,
  next: string,
  closed: boolean,
  now: number,
  intervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS,
): boolean {
  if (closed) return prev === null || prev.code !== next;   // 终态必须准确
  if (prev === null) return true;                            // 第一帧尽快给
  if (fenceRenderSignature(next) === prev.signature) return false;
  return now - prev.at >= intervalMs;
}

export function nextSample(next: string, now: number): SampleState {
  return { code: next, signature: fenceRenderSignature(next), at: now };
}

/**
 * 取样 hook——canvas 与 mermaid 两条围栏共用**同一份**节奏，不写第二份。
 *
 * 返回的 `renderCode` 就是渲染层该消费的源码：围栏闭合后与 `code` 一致；
 * 未闭合时按上面的规则跟进。
 */
export function useSampledFenceCode(code: string, closed: boolean): string {
  const [sample, setSample] = React.useState<SampleState | null>(null);
  React.useEffect(() => {
    const now = Date.now();
    if (shouldResample(sample, code, closed, now, DEFAULT_SAMPLE_INTERVAL_MS)) {
      setSample(nextSample(code, now));
      return;
    }
    if (closed || sample === null) return;
    // 签名变了但间隔没到：挂一个定时器到点再试。否则这一段内容要等下一个 chunk 才会
    // 被画出来，而模型完全可能在这里停顿几秒。
    const wait = Math.max(0, DEFAULT_SAMPLE_INTERVAL_MS - (now - sample.at));
    const t = window.setTimeout(
      () => setSample((prev) => (prev === null ? prev : nextSample(code, Date.now()))),
      wait + 10,
    );
    return () => window.clearTimeout(t);
  }, [code, closed, sample]);
  return sample?.code ?? code;
}
