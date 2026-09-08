/**
 * 轨迹「活性」判据（issue #3122 —— 修 #3104 引入的恒真判据）
 *
 * #3104 把判据换成「发送前装 MutationObserver，断言存在早于 streamFinishedAt 的样本，
 * 其页面级 `[data-testid="run-trace-entry"]` 数量 ≥ 1」。这在「项目」档上**恒真**：
 * ① 该档落在壳恢复出来的、已有历史的线程上，页面上本来就挂着历史 run 的条目；
 * ② 折叠态的条目也在 DOM 里（`run-trace-body` 只是 `hidden`）。
 * 于是装采样器那一刻的第 0 个样本就已经 count ≥ 1，本轮 run 一条轨迹都不渲染也照样绿。
 *
 * 修法：判据必须同时满足「只有本轮才满足」——
 * ① 采样按 `data-run-id` 分 panel 记数，判定时**只看本轮那个 runId**，并减去装采样器那一刻
 *    该 runId 的存量（baseline，历史线程上晚到的历史 panel 因此也进不了判定）。
 * ② 采样窗口从**点发送之后**开始（`sendAt`），装载时的第 0 个样本不参与判定。
 * 语义不变：「工具活动在运行流结束前就可见」。
 *
 * 时钟：`at` 取浏览器 `Date.now()`，而 `sendAt`/`streamFinishedAt` 取自 Node 侧。
 * 调用方须先量出偏移（浏览器 Date.now() − Node Date.now()），用 `toBrowserClock()` 把 Node 时间戳换算到浏览器时钟再传进来（#3122 尾注）。
 */
export const TRACE_SAMPLER = `(() => {
  const snapshot = () => {
    const map = {};
    document.querySelectorAll('[data-testid="run-trace-panel"]').forEach((panel) => {
      const key = panel.getAttribute('data-run-id') || '(no-run-id)';
      map[key] = (map[key] || 0) + panel.querySelectorAll('[data-testid="run-trace-entry"]').length;
    });
    return map;
  };
  const baseline = snapshot();
  const samples = [];
  const sample = () => {
    const current = snapshot();
    let total = 0;
    for (const key of Object.keys(current)) total += current[key];
    samples.push({ at: Date.now(), counts: current, total: total });
  };
  sample();
  new MutationObserver(sample).observe(document.body, { childList: true, subtree: true });
  window.__traceSamples = samples;
  window.__traceBaseline = baseline;
})()`;

export type TraceSample = { at: number; counts: Record<string, number>; total: number };
export type TraceBaseline = Record<string, number>;

export type LivenessVerdict = { live: boolean; message: string };

/** 本轮 run（`runId`）自己的条目必须在 `sendAt` 之后、`streamFinishedAt` 之前进入 DOM。 */
export function judgeLiveness(
  samples: readonly TraceSample[], baseline: TraceBaseline, runId: string | null, sendAt: number, streamFinishedAt: number,
): LivenessVerdict {
  if (!runId) return { live: false, message: "本轮 run 的 run-trace-panel 没有 data-run-id，活性无法取证" };
  const stock = baseline[runId] ?? 0;
  const window_ = samples.filter((sample) => sample.at >= sendAt && sample.at < streamFinishedAt);
  const fresh = window_.map((sample) => Math.max(0, (sample.counts[runId] ?? 0) - stock));
  return {
    live: fresh.some((count) => count >= 1),
    message:
      `本轮 run（${runId}）的轨迹条目必须在运行流结束前进入 DOM——发送于 ${sendAt}，流结束于 ${streamFinishedAt}，`
      + `窗口内共 ${window_.length} 次采样，本轮新增条目数最大 ${Math.max(0, ...fresh)}（该 run 存量 ${stock}）`
      + `；窗口内页面条目总数最大 ${Math.max(0, ...window_.map((sample) => sample.total))}，存量与其它 run 不计入判定`,
  };
}

/** 浏览器时钟 − Node 时钟。把 Node 侧时间戳加上它即得同侧可比的时间戳。 */
export function toBrowserClock(nodeTimestamp: number, skew: number): number {
  return nodeTimestamp + skew;
}
