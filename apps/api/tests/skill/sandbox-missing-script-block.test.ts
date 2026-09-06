/**
 * 2026-09-06 devapp 实测事故：用户要一份中文 PDF，最后拿到的失败原因是
 *
 *   `model reply contained no fenced script block; reply was: 我已经把…整理成了一份 PDF…`
 *
 * 也就是一句**关于回复格式的内部抱怨**，而第 1 次尝试真正拿到的沙箱 stderr 不见了。
 * 这里锁两件事，各配反证：
 *
 * ① 模型某一轮漏写脚本围栏是**可纠正**的，不该当场终止整个循环——回喂里明确要求
 *   「只回一个 run_script 块」，通常一次就好。
 * ② 重试用尽时报出去的必须是**最后一次真的跑起来过**的沙箱 stderr。只有从头到尾
 *   一个脚本都没执行过时，「没有脚本块」才是真因本身。
 *
 * ⚠ 这两条不是同一条：即便修好了 ①，若报错仍取 history 的最后一条，真因照样被
 *   最后那次「没给脚本」覆盖掉——#660 / #1611 记过两次的同一条纪律在这条缝里失效。
 */
import { describe, expect, it } from "vitest";
import {
  ScriptFailedAfterRetriesError,
  runScriptWithRetries,
} from "../../src/application/skill/run-script-with-retries";
import type {
  SandboxRunResult,
  SkillSandboxPort,
} from "../../src/application/skill/skill-sandbox-port";

/** 用户实测里模型那轮的形状：一段散文，声称文件已经生成，没有任何代码围栏。 */
const PROSE_REPLY = "我已经把「我能做什么」整理成了一份 PDF 介绍文档，请查看附件下载。";

const REAL_STDERR =
  "Error: Cannot find module '@pdf-lib/fontkit'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)";

function sandboxAlways(result: SandboxRunResult): SkillSandboxPort & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: (input) => {
      calls.push(input.script);
      return Promise.resolve(result);
    },
  };
}

const FAILED: SandboxRunResult = {
  exitCode: 1,
  stdout: "",
  stderr: REAL_STDERR,
  files: [],
  timedOut: false,
  durationMs: 5,
};

const OK: SandboxRunResult = {
  exitCode: 0,
  stdout: "WROTE",
  stderr: "",
  files: [{ name: "report.pdf", contentBase64: "AAA=", sizeBytes: 3 }],
  timedOut: false,
  durationMs: 9,
};

describe("模型漏写脚本围栏：可纠正，且不许盖掉真因", () => {
  it("① 缺块的那一轮得到纠正性回喂，下一轮给出脚本就照常执行成功", async () => {
    const sandbox = sandboxAlways(OK);
    const seen: (string | null)[] = [];
    let n = 0;

    const result = await runScriptWithRetries({
      sandbox,
      timeoutMs: 1_000,
      generateScript: (feedback) => {
        seen.push(feedback);
        n += 1;
        // 第 1 轮学用户实测那样只说话；第 2 轮才给脚本。
        return Promise.resolve(n === 1 ? PROSE_REPLY : "```run_script\nconsole.log('ok');\n```");
      },
    });

    expect(result.attempts).toBe(2);
    expect(result.files).toHaveLength(1);
    // 沙箱在缺块那一轮**一次都不该被调用**——没有脚本就没有东西可执行。
    expect(sandbox.calls).toHaveLength(1);
    // 纠正性回喂必须真的告诉模型「要一个 run_script 块」，而不是空转一轮。
    expect(seen[1]).toContain("run_script");
    expect(seen[1]).toMatch(/no runnable script block|nothing was executed/i);
  });

  it("② 跑过一次真失败、之后模型不再给脚本 —— 报的是沙箱真实 stderr，不是格式抱怨", async () => {
    const sandbox = sandboxAlways(FAILED);
    let n = 0;

    const error = await runScriptWithRetries({
      sandbox,
      timeoutMs: 1_000,
      generateScript: () => {
        n += 1;
        return Promise.resolve(
          n === 1 ? "```run_script\nrequire('@pdf-lib/fontkit');\n```" : PROSE_REPLY,
        );
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ScriptFailedAfterRetriesError);
    const failure = error as ScriptFailedAfterRetriesError;
    expect(failure.lastStderr).toContain("Cannot find module '@pdf-lib/fontkit'");
    expect(failure.lastExitCode).toBe(1);
    // 反证：这正是修复前用户看到的那句话，它不许再成为报给用户的「真因」。
    expect(failure.lastStderr).not.toContain("no fenced script block");
  });

  it("③ 从头到尾一个脚本都没执行过时，「没有脚本块」本身就是真因，如实报出", async () => {
    const sandbox = sandboxAlways(OK);

    const error = await runScriptWithRetries({
      sandbox,
      timeoutMs: 1_000,
      generateScript: () => Promise.resolve(PROSE_REPLY),
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ScriptFailedAfterRetriesError);
    const failure = error as ScriptFailedAfterRetriesError;
    expect(failure.lastStderr).toContain("no fenced script block");
    // 模型那句「请查看附件下载」要原样带回去——它是判断「模型为什么不写脚本」的唯一线索。
    expect(failure.lastStderr).toContain("请查看附件下载");
    expect(failure.lastExitCode).toBeNull();
    expect(sandbox.calls).toHaveLength(0);
  });
});
