/**
 * 退出码 0 ≠ 有产物（2026-09-24 真实模型实测）。
 *
 * 人类的 prompt 是「深度研究中国的教育和人工智能会如何融合，然后生成一个 ppt」。
 * 那一轮：跑了 429 秒、脚本退出码 0、界面**全程没有错误横幅**（real-model lane 的
 * 断言 ④ 通过），而产出文件卡数量为 0——**用户什么也没拿到，系统却认为成功**。
 * 证据：`apps/web/test-results/real-model-evidence/01-verdict.txt`。
 *
 * 空产出是**可纠正**的（脚本忘了往 `SKILL_SANDBOX_OUT_DIR` 写），与「模型没给脚本块」
 * 同一性质，所以先回喂重试；全部尝试都空 ⇒ 抛 `ScriptProducedNoFilesError`，
 * 而不是冒充成「脚本报错」——那会让排查往「脚本哪里写错了」跑，而真相是
 * 「它从来没往输出目录写东西」。
 *
 * 替身与写法沿用 `sandbox-retry-and-failure-codes.test.ts`，不另造一套。
 */
import { describe, expect, it } from "vitest";
import {
  ScriptFailedAfterRetriesError,
  ScriptProducedNoFilesError,
  runScriptWithRetries,
} from "../../src/application/skill/run-script-with-retries";
import type { SandboxRunResult, SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";

/** 跑通了，但输出目录里什么都没有——这次实测的那一幕。 */
function emptyOutput(): SandboxRunResult {
  return { exitCode: 0, stdout: "done", stderr: "", files: [], timedOut: false, durationMs: 5 };
}
function produced(): SandboxRunResult {
  return {
    exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 5,
    files: [{ path: "deck.pptx", bytes: 2048 }] as unknown as SandboxRunResult["files"],
  };
}
function failing(): SandboxRunResult {
  return { exitCode: 1, stdout: "", stderr: "TypeError: boom", files: [], timedOut: false, durationMs: 5 };
}

function scriptedSandbox(sequence: readonly SandboxRunResult[]): SkillSandboxPort & { readonly calls: string[] } {
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

function generator(seen: string[]): (feedback: string | null) => Promise<string> {
  return (feedback) => {
    seen.push(feedback ?? "none");
    return Promise.resolve("```run_script\nconsole.log('x');\n```");
  };
}

describe("脚本跑通但没写文件", () => {
  it("第一次空产出会回喂重试，且回喂指名道姓地说「写进输出目录」", async () => {
    const seen: string[] = [];
    const sandbox = scriptedSandbox([emptyOutput(), produced()]);
    const result = await runScriptWithRetries({ sandbox, generateScript: generator(seen), timeoutMs: 30_000 });

    expect(result.files).toHaveLength(1);
    expect(result.attempts).toBe(2);
    expect(sandbox.calls).toHaveLength(2);
    // 不说清该改什么，模型只会再交一份同样不写文件的脚本。
    expect(seen.at(-1)).toContain("SKILL_SANDBOX_OUT_DIR");
  });

  it("每一次都空产出 ⇒ ScriptProducedNoFilesError，不冒充成脚本报错", async () => {
    const sandbox = scriptedSandbox([emptyOutput()]);
    await expect(
      runScriptWithRetries({ sandbox, generateScript: generator([]), timeoutMs: 30_000, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(ScriptProducedNoFilesError);
  });

  it("真的报错过的那条路径仍然抛 ScriptFailedAfterRetriesError（没被这次改动顶掉）", async () => {
    const sandbox = scriptedSandbox([failing()]);
    await expect(
      runScriptWithRetries({ sandbox, generateScript: generator([]), timeoutMs: 30_000, maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(ScriptFailedAfterRetriesError);
  });
});
