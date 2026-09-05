/**
 * issue #2795 -- unit coverage for `startAguiSseHeartbeat` in isolation from the rest of
 * `copilotkit-agui.controller.ts`. That file's own SSE coverage (`agui-bridge-sse.test.ts`)
 * is deliberately a real-socket, real-Postgres integration test (see its own file head) --
 * not a place to also pin down a 15-second-interval timing detail with fake timers. This
 * file exercises exactly the seam `startAguiSseHeartbeat` was extracted to expose: a plain
 * `write` callback and an interval, no `Response`, no Nest app, no DB.
 *
 * What this proves, concretely: a turn whose `write(event)` calls (the AG-UI frame writer)
 * go silent for a long stretch -- exactly the "one long model call, then a silent sandboxed
 * script run" shape `poll-budget.ts` documents for real PDF-generation turns -- still emits
 * SOMETHING on the wire during that stretch, and stops emitting the instant the caller says
 * the turn is done. Regression target: before this fix, a turn like that wrote nothing at
 * all between `RUN_STARTED` and its terminal event, which is exactly the silence an
 * intermediate hop's idle-connection timeout (undici's default `fetch` bodyTimeout chief
 * among them, per this file's own doc in the controller) tears down mid-run as
 * `Error: terminated`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGUI_SSE_HEARTBEAT_INTERVAL_MS, startAguiSseHeartbeat } from "../../src/interface/controllers/copilotkit-agui.controller";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #2795 -- startAguiSseHeartbeat", () => {
  it("writes nothing before the first interval elapses", () => {
    const write = vi.fn();
    const stop = startAguiSseHeartbeat(write, AGUI_SSE_HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(AGUI_SSE_HEARTBEAT_INTERVAL_MS - 1);
    expect(write).not.toHaveBeenCalled();
    stop();
  });

  it("keeps writing every interval while a turn stays silent for minutes", () => {
    const write = vi.fn();
    const stop = startAguiSseHeartbeat(write, AGUI_SSE_HEARTBEAT_INTERVAL_MS);
    // 20 ticks at the real 15s default is 5 real minutes of an otherwise byte-silent
    // connection -- comfortably inside the model-call + sandboxed-script window
    // `poll-budget.ts` documents a real PDF-generation turn can spend saying nothing.
    vi.advanceTimersByTime(AGUI_SSE_HEARTBEAT_INTERVAL_MS * 20);
    expect(write).toHaveBeenCalledTimes(20);
    stop();
  });

  it("stops immediately once the caller calls stop(), even mid-run", () => {
    const write = vi.fn();
    const stop = startAguiSseHeartbeat(write, AGUI_SSE_HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(AGUI_SSE_HEARTBEAT_INTERVAL_MS * 3);
    expect(write).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(AGUI_SSE_HEARTBEAT_INTERVAL_MS * 10);
    // No further writes -- a heartbeat that outlived the request would write bytes into a
    // response nobody is reading anymore.
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("calling stop() twice is a no-op, not a throw", () => {
    const write = vi.fn();
    const stop = startAguiSseHeartbeat(write, AGUI_SSE_HEARTBEAT_INTERVAL_MS);
    stop();
    expect(() => stop()).not.toThrow();
  });
});
