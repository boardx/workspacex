/**
 * `verification.md` **V3**（重试循环真的在重试）与 **V4**（三个新失败码各自可达、
 * 不串味），各配反证。design delta `skill-sandbox-execution`，F962 / #1583。
 *
 * ⚠ 反证在本仓是硬要求（已九次踩过"全绿但空转"）。所以每一条门控下面都紧跟着
 *   一条"把它改坏之后必须变红"的断言，而不是只证明正路能走通。
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SCRIPT_ATTEMPTS,
  ScriptFailedAfterRetriesError,
  SandboxTimeoutError,
  runScriptWithRetries,
} from "../../src/application/skill/run-script-with-retries";
import {
  SandboxUnavailableError,
  type SandboxRunResult,
  type SkillSandboxPort,
} from "../../src/application/skill/skill-sandbox-port";

const OK: SandboxRunResult = {
  exitCode: 0,
  stdout: "done",
  stderr: "",
  files: [{ name: "deck.pptx", contentBase64: "AAA=", sizeBytes: 3 }],
  timedOut: false,
  durationMs: 10,
};

const REAL_STDERR =
  "TypeError: pres.ShapeType is not a function\n    at Object.<anonymous> (/tmp/work/script.js:7:22)";

function failing(stderr = REAL_STDERR): SandboxRunResult {
  return { exitCode: 1, stdout: "", stderr, files: [], timedOut: false, durationMs: 5 };
}

/** 按脚本序列作答的确定性替身，并记录**真实发生了几次执行**。 */
function scriptedSandbox(sequence: readonly SandboxRunResult[]): SkillSandboxPort & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    run: (input) => {
      const result = sequence[calls.length] ?? sequence[sequence.length - 1]!;
      calls.push(input.script);
      return Promise.resolve(result);
    },
  };
}

function generator(): (feedback: string | null) => Promise<string> {
  let n = 0;
  return (feedback) => {
    n += 1;
    // 把回喂内容原样带进脚本，方便断言"第 2 次真的看到了第 1 次的 stderr"。
    return Promise.resolve(
      ["```run_script", `// attempt ${String(n)}`, `// feedback: ${feedback ?? "none"}`, "```"].join(
        "\n",
      ),
    );
  };
}

describe("V3 重试循环真的在重试", () => {
  it("first attempt fails, second succeeds — and exactly 2 executions happened", async () => {
    const sandbox = scriptedSandbox([failing(), OK]);

    const result = await runScriptWithRetries({
      sandbox,
      generateScript: generator(),
      timeoutMs: 30_000,
    });

    // ① 最终成功
    expect(result.files).toHaveLength(1);
    // ② 确实发生了 2 次执行——不是第一次就蒙对
    expect(result.attempts).toBe(2);
    expect(sandbox.calls).toHaveLength(2);
    // ③ 第二次是**在看到第一次的真实 stderr 之后**生成的，不是盲目重试
    expect(sandbox.calls[0]).toContain("feedback: none");
    expect(sandbox.calls[1]).toContain("pres.ShapeType is not a function");
    expect(sandbox.calls[1]).toContain("exit code 1");
  });

  it("V3-CP 反证：把上限改成 1，同一场景必须变红", async () => {
    const sandbox = scriptedSandbox([failing(), OK]);

    await expect(
      runScriptWithRetries({
        sandbox,
        generateScript: generator(),
        timeoutMs: 30_000,
        maxAttempts: 1, // ← 唯一改动
      }),
    ).rejects.toBeInstanceOf(ScriptFailedAfterRetriesError);

    // 且确实只执行了 1 次——证明上限真的是上限，不是装饰。
    expect(sandbox.calls).toHaveLength(1);
  });

  it("contract §7 的上限就是 3，且用尽后不再多跑一次", async () => {
    const sandbox = scriptedSandbox([failing(), failing(), failing()]);

    await expect(
      runScriptWithRetries({ sandbox, generateScript: generator(), timeoutMs: 30_000 }),
    ).rejects.toBeInstanceOf(ScriptFailedAfterRetriesError);

    expect(MAX_SCRIPT_ATTEMPTS).toBe(3);
    expect(sandbox.calls).toHaveLength(3);
  });
});

describe("V4 三个新失败码各自可达且不串味", () => {
  it("SANDBOX_UNAVAILABLE：沙箱不可达 ⇒ 该码，且不消耗重试次数", async () => {
    const calls: string[] = [];
    const sandbox: SkillSandboxPort = {
      run: (input) => {
        calls.push(input.script);
        return Promise.reject(new SandboxUnavailableError("connect ECONNREFUSED"));
      },
    };

    const error = await runScriptWithRetries({
      sandbox,
      generateScript: generator(),
      timeoutMs: 30_000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SandboxUnavailableError);
    // ⚠ 关键：它**不是** ScriptFailedAfterRetriesError，也不是 MODEL_UNAVAILABLE。
    expect(error).not.toBeInstanceOf(ScriptFailedAfterRetriesError);
    // ⚠ 且不该白白重试三次——一次运维故障重试三次只会拖长故障、报错码。
    expect(calls).toHaveLength(1);
  });

  it("SANDBOX_TIMEOUT：脚本超硬超时 ⇒ 该码，与脚本写错区分开", async () => {
    const sandbox = scriptedSandbox([
      { exitCode: null, stdout: "", stderr: "", files: [], timedOut: true, durationMs: 30_000 },
    ]);

    const error = await runScriptWithRetries({
      sandbox,
      generateScript: generator(),
      timeoutMs: 30_000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SandboxTimeoutError);
    expect(error).not.toBeInstanceOf(ScriptFailedAfterRetriesError);
    expect(error).not.toBeInstanceOf(SandboxUnavailableError);
  });

  it("SCRIPT_FAILED_AFTER_RETRIES：带回**最后一次真实 stderr 原文**，不是「请重试」", async () => {
    const lastStderr = "ReferenceError: slideDeck is not defined\n    at /tmp/work/script.js:3:1";
    const sandbox = scriptedSandbox([failing(), failing(), failing(lastStderr)]);

    const error = (await runScriptWithRetries({
      sandbox,
      generateScript: generator(),
      timeoutMs: 30_000,
    }).catch((e: unknown) => e)) as ScriptFailedAfterRetriesError;

    expect(error).toBeInstanceOf(ScriptFailedAfterRetriesError);
    expect(error.attempts).toBe(3);
    // ⚠ #660 纪律：真实原因不许被翻译掉。
    expect(error.lastStderr).toBe(lastStderr);
    expect(error.lastStderr).toContain("ReferenceError");
    expect(error.lastStderr).not.toMatch(/请重试|please try again/i);
  });

  it("V4-CP 反证：把三个码合并成一个通用码，本组断言必须变红", () => {
    /**
     * 反证做法：模拟"合并"——即所有失败都成为同一个类型。断言在那种实现下，
     * V4 赖以区分的三条 `not.toBeInstanceOf` 全部失去意义。
     * 这里用类型层面的事实直接钉死：三个错误类必须是**彼此不同**的类型。
     */
    const unavailable = new SandboxUnavailableError("x");
    const timeout = new SandboxTimeoutError(1);
    const failed = new ScriptFailedAfterRetriesError(3, "stderr", 1);

    const names = new Set([unavailable.name, timeout.name, failed.name]);
    // 合并成一个通用码时这里会变成 1，断言立刻红。
    expect(names.size).toBe(3);

    expect(unavailable).not.toBeInstanceOf(SandboxTimeoutError);
    expect(timeout).not.toBeInstanceOf(ScriptFailedAfterRetriesError);
    expect(failed).not.toBeInstanceOf(SandboxUnavailableError);
  });
});
