/**
 * D2 活性判据的反证（issue #3122）
 *
 * 判据本身（`e2e/support/trace-liveness.ts`）跑在真浏览器里，但**它能不能红**不必起真栈就能证。
 * 这里在 jsdom 里装同一段下发到浏览器的采样器脚本、按三种产品行为造 DOM 变更，断言判定结果：
 *   live-render（流中渲染）→ 绿；buffered（全部等到流结束后才渲染）→ 红；never-render → 红。
 * 并同时跑一遍 #3104 那版旧判据，证明在「已恢复的有历史线程」上旧判据三种行为**全绿**（恒真），
 * 而新判据能红。三者任一不符合，就说明判据还没修好。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TRACE_SAMPLER, judgeLiveness, type TraceBaseline, type TraceSample } from "../../e2e/support/trace-liveness";

type Scope = { __traceSamples: TraceSample[]; __traceBaseline: TraceBaseline };
type Behaviour = "live-render" | "buffered" | "never-render";

function panel(runId: string, entries: number): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("data-testid", "run-trace-panel");
  section.setAttribute("data-run-id", runId);
  const body = document.createElement("div");
  body.setAttribute("data-testid", "run-trace-body");
  body.hidden = true; // 折叠态：条目仍在 DOM 里，这正是旧判据恒真的前提②
  appendInto(body, entries);
  section.append(body);
  return section;
}
function appendInto(body: Element, entries: number): void {
  for (let index = 0; index < entries; index += 1) {
    const li = document.createElement("li");
    li.setAttribute("data-testid", "run-trace-entry");
    body.append(li);
  }
}
function appendEntries(runId: string, entries: number): void {
  appendInto(document.querySelector(`[data-run-id="${runId}"] [data-testid="run-trace-body"]`)!, entries);
}
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** #3104 那版判据：全页面计数、含装载时的第 0 个样本、只要求早于流结束。 */
function legacyVerdict(samples: readonly TraceSample[], streamFinishedAt: number): boolean {
  return samples.filter((sample) => sample.at < streamFinishedAt).some((sample) => sample.total >= 1);
}

/** 走一遍剧本：装采样器（可选存量历史 panel）→ 发送 → 按 behaviour 渲染 → 流结束。 */
async function play(options: { history: number; behaviour: Behaviour }) {
  document.body.innerHTML = "";
  if (options.history > 0) document.body.append(panel("run-history", options.history));
  await flush();

  vi.setSystemTime(1_000);
  // 反证必须跑真正下发到浏览器的那段脚本，不是它的复制品
  (0, eval)(TRACE_SAMPLER);
  const scope = window as unknown as Scope;

  vi.setSystemTime(1_100);
  const sendAt = Date.now();

  vi.setSystemTime(1_200);
  document.body.append(panel("run-current", 0)); // 本轮 panel 挂载（尚无条目）
  await flush();

  if (options.behaviour === "live-render") {
    vi.setSystemTime(1_400);
    appendEntries("run-current", 3);
    await flush();
  }
  // 有历史的线程上，历史 panel 可能晚到；它不该让本轮判据变绿
  vi.setSystemTime(1_500);
  if (options.history > 0) document.body.append(panel("run-history-late", 4));
  await flush();

  vi.setSystemTime(2_000);
  const streamFinishedAt = Date.now();

  if (options.behaviour === "buffered") {
    vi.setSystemTime(2_500);
    appendEntries("run-current", 3); // 流结束后才一次性灌进来
    await flush();
  }
  const verdict = judgeLiveness(scope.__traceSamples, scope.__traceBaseline, "run-current", sendAt, streamFinishedAt);
  return { verdict, legacy: legacyVerdict(scope.__traceSamples, streamFinishedAt) };
}

describe("D2 活性判据反证（#3122）", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  for (const history of [0, 2]) {
    const lane = history > 0 ? "项目（已恢复的有历史线程）" : "个人（空线程）";
    it(`${lane}：live-render 绿`, async () => {
      const { verdict } = await play({ history, behaviour: "live-render" });
      expect(verdict.live, verdict.message).toBe(true);
    });
    it(`${lane}：buffered 红`, async () => {
      const { verdict } = await play({ history, behaviour: "buffered" });
      expect(verdict.live, verdict.message).toBe(false);
      expect(verdict.message).toContain("本轮新增条目数最大 0");
    });
    it(`${lane}：never-render 红`, async () => {
      const { verdict } = await play({ history, behaviour: "never-render" });
      expect(verdict.live, verdict.message).toBe(false);
    });
  }

  it("旧判据在有历史线程上三种行为全绿（恒真），新判据能红", async () => {
    const behaviours: Behaviour[] = ["live-render", "buffered", "never-render"];
    const results: { behaviour: Behaviour; live: boolean; legacy: boolean }[] = [];
    for (const behaviour of behaviours) {
      const { verdict, legacy } = await play({ history: 2, behaviour });
      results.push({ behaviour, live: verdict.live, legacy });
    }
    expect(results.map((row) => row.legacy)).toEqual([true, true, true]);
    expect(results.map((row) => row.live)).toEqual([true, false, false]);
  });
});
