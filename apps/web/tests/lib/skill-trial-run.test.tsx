/**
 * F962 之后 `POST /trial-run` 恒转异步；这里测的是补的那半条轮询链路
 * （`apps/web/lib/skill-trial-run.ts` 头注「POST 恒转异步，轮询是必需的一半」）。
 *
 * 用 `vi.useFakeTimers()` 让退避的 400ms/600ms/900ms… 不真的等，测试秒过；
 * 断言的是"轮询到终态就停、非终态继续问、预算耗尽就诚实抛错"这三条真实行为，
 * 不是随便 mock 一次就算过。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import {
  getSkillTrialRun,
  isTerminalTrialRunStatus,
  isTrialRunAuthExpiredError,
  pollSkillTrialRun,
} from "@/lib/skill-trial-run";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isTerminalTrialRunStatus", () => {
  it("queued/running 非终态，succeeded/failed 终态——与 execute-trial-run.ts 的状态机一致", () => {
    expect(isTerminalTrialRunStatus("queued")).toBe(false);
    expect(isTerminalTrialRunStatus("running")).toBe(false);
    expect(isTerminalTrialRunStatus("succeeded")).toBe(true);
    expect(isTerminalTrialRunStatus("failed")).toBe(true);
  });
});

describe("isTrialRunAuthExpiredError（issue #1941）", () => {
  it("ApiError(401, ...) → true", () => {
    expect(isTrialRunAuthExpiredError(new ApiError(401, "UNAUTHORIZED", undefined))).toBe(true);
  });

  it("其它状态码（如 503）→ false，不误判成「过期」", () => {
    expect(isTrialRunAuthExpiredError(new ApiError(503, "DEPENDENCY_UNAVAILABLE", undefined))).toBe(false);
  });

  it("非 ApiError（如普通 Error/字符串）→ false", () => {
    expect(isTrialRunAuthExpiredError(new Error("boom"))).toBe(false);
    expect(isTrialRunAuthExpiredError("boom")).toBe(false);
  });
});

describe("pollSkillTrialRun", () => {
  it("非终态时继续轮询，到 succeeded 才停，且真的调用了多次 GET（不是问一次就当结果）", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call < 3) return jsonResponse({ trialRunId: "tr_1", status: "running", trialRun: null, failure: null });
      return jsonResponse({
        trialRunId: "tr_1",
        status: "succeeded",
        trialRun: { trialRunId: "tr_1", versionId: "v1", input: "x", output: "真实输出", durationMs: 120, tokens: 8, hitDataScope: [], artifacts: [] },
        failure: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_1");
    // 让所有挂起的定时器逐个触发，直到 promise 落定——真实驱动退避循环，不是假装等过了。
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(call).toBe(3);
    expect(result.status).toBe("succeeded");
    expect(result.trialRun?.output).toBe("真实输出");
  });

  it("终态是 failed 时立即停止轮询，返回带 failure 详情的终态（不是继续问到超预算）", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        trialRunId: "tr_2",
        status: "failed",
        trialRun: null,
        failure: { code: "SCRIPT_FAILED_AFTER_RETRIES", stderr: "Traceback...", attempts: 3 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_2");
    // 首次读取前有一次退避等待（见源文件「提交响应刚落地就问，多半还没来得及被
    // 自己的写路径看见」），把它驱动过去，再取结果。
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SCRIPT_FAILED_AFTER_RETRIES");
    expect(result.failure?.stderr).toContain("Traceback");
  });

  it("宽限期内的 404（刚提交、还没来得及可见）当非终态处理，继续轮询到真正的终态", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse({ message: "Not Found" }, 404);
      return jsonResponse({
        trialRunId: "tr_4",
        status: "succeeded",
        trialRun: { trialRunId: "tr_4", versionId: "v1", input: "x", output: "真实输出", durationMs: 50, tokens: 4, hitDataScope: [], artifacts: [] },
        failure: null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_4");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(call).toBe(2);
    expect(result.status).toBe("succeeded");
  });

  it("404 持续超过宽限期：不是「刚提交还没可见」，原样抛出不吞掉", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: "Not Found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_5");
    const assertion = expect(promise).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("issue #1941 · 401 立即停止轮询：只打一次 GET，原样抛出（不进宽限期/退避）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_6");
    const assertion = expect(promise).rejects.toMatchObject({ status: 401 });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    // 不是 404 的宽限期分支——只应该打过一次 GET，不该像 404 那样再退避重试。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("预算耗尽仍未到终态：诚实抛错，不假装成功也不无限等下去", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ trialRunId: "tr_3", status: "running", trialRun: null, failure: null }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = pollSkillTrialRun("tr_3");
    const assertion = expect(promise).rejects.toThrow("TRIALRUN_POLL_BUDGET_EXCEEDED");
    // 300s 预算，退避封顶 3s——推进比预算更长的虚拟时间，逼一次真实的预算耗尽路径。
    await vi.advanceTimersByTimeAsync(310_000);
    await assertion;
  });
});

describe("getSkillTrialRun", () => {
  it("真实调用 GET /skill-trial-runs/:trialRunId，路径参数真实替换", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.pathname).toContain("/skill-trial-runs/tr_abc");
      return jsonResponse({ trialRunId: "tr_abc", status: "queued", trialRun: null, failure: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await getSkillTrialRun("tr_abc");
    expect(out.trialRunId).toBe("tr_abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
