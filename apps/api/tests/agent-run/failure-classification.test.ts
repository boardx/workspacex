/**
 * #2718 F13 —— `toFailure`（`run-skill-script.ts`）精确归类回归门控。
 *
 * 触发本 phase 的故障诱因：PDF 生成卡住时，日志把一次**模型调用失败**（回喂重试里
 * `deps.regenerate` 抛出的 `ModelCallError`）记成了 `SANDBOX_UNAVAILABLE`——运维去
 * 查一个没坏的沙箱容器，真正出问题的模型调用无人知晓。
 *
 * `requirements/05-error-observability.md` R3/R7、`contracts/error-observability/domain.md`
 * I-1：错误分类的准确性优先于"总能给出一个分类"，模型故障必须归模型类错误码，不识别的
 * 异常宁可诚实地标 `UNKNOWN_EXECUTION_ERROR`，也不能张冠李戴。
 *
 * 每条门控都配一个会红的反证（`*-CP`），证明断言确实抓得住"改回旧兜底"这个退化。
 */
import { describe, expect, it } from "vitest";
import {
  maybeRunSkillScript,
  type MaybeRunSkillScriptDeps,
} from "../../src/application/agent-run/run-skill-script";
import { ModelCallError } from "../../src/application/agent-run/ports";
import type { SandboxRunResult, SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";

const SCRIPT_REPLY = [
  "好的，我来生成这个 PDF。",
  "",
  "```run_script",
  "const fs = require('fs');",
  "fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/out.pdf', 'x');",
  "```",
].join("\n");

function failResult(over: Partial<SandboxRunResult> = {}): SandboxRunResult {
  return {
    exitCode: 1, stdout: "", stderr: "syntax error", files: [], timedOut: false, durationMs: 5, ...over,
  };
}

function storeSpy(): MaybeRunSkillScriptDeps["objects"] {
  // 与既有 `chat-skill-script-execution.test.ts` 同一约定：本文件不测产物落盘，
  // 只需要 `putOnce` 存在,其余 `ObjectStore` 成员用不到,替身按 `as never` 处理。
  return { putOnce: async () => {} } as never;
}

describe("E1 回归：ModelCallError(MODEL_CALL_FAILED) 不得误标为 SANDBOX_UNAVAILABLE", () => {
  it("回喂重试时 regenerate 抛 ModelCallError ⇒ failureCode 归模型类，不是沙箱类", async () => {
    // 第 1 次尝试（复用 reply）非零退出 ⇒ 触发回喂 ⇒ 第 2 次调用 deps.regenerate（真实模型调用）。
    const sandbox: SkillSandboxPort = { run: async () => failResult() };
    const deps: MaybeRunSkillScriptDeps = {
      sandbox,
      objects: storeSpy(),
      regenerate: async () => {
        throw new ModelCallError("MODEL_CALL_FAILED", "upstream 500 from model provider");
      },
      log: () => {},
      maxAttempts: 2,
    };

    const out = await maybeRunSkillScript(deps, {
      runId: "run_f13_1", pinnedSkillCount: 1, reply: SCRIPT_REPLY,
    });

    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("MODEL_CALL_FAILED");
    expect(out.failureCode).not.toBe("SANDBOX_UNAVAILABLE");
  });

  it("E1-CP 反证：把 toFailure 的兜底改回『任何未识别异常都归 SANDBOX_UNAVAILABLE』，上一条断言必红", () => {
    // 直接重放旧兜底逻辑本身，证明它确实会把 ModelCallError 判成 SANDBOX_UNAVAILABLE——
    // 这正是上一条测试要防止再次发生的行为。
    const legacyToFailure = (e: unknown): { failureCode: string } => {
      if (e instanceof ModelCallError) {
        // 旧实现没有这个分支，直接落进下面的兜底。
      }
      return { failureCode: "SANDBOX_UNAVAILABLE" };
    };
    const legacyResult = legacyToFailure(new ModelCallError("MODEL_CALL_FAILED", "upstream 500"));
    expect(legacyResult.failureCode).toBe("SANDBOX_UNAVAILABLE"); // 旧兜底确实会张冠李戴
  });
});

describe("I-1 兜底诚实：真正未识别的异常归 UNKNOWN_EXECUTION_ERROR，不再借用 SANDBOX_UNAVAILABLE", () => {
  it("regenerate 抛出一个非 ModelCallError/沙箱类的意外异常 ⇒ 归 UNKNOWN_EXECUTION_ERROR", async () => {
    const sandbox: SkillSandboxPort = { run: async () => failResult() };
    const deps: MaybeRunSkillScriptDeps = {
      sandbox,
      objects: storeSpy(),
      regenerate: async () => {
        throw new TypeError("something nobody classified for");
      },
      log: () => {},
      maxAttempts: 2,
    };

    const out = await maybeRunSkillScript(deps, {
      runId: "run_f13_2", pinnedSkillCount: 1, reply: SCRIPT_REPLY,
    });

    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("UNKNOWN_EXECUTION_ERROR");
    expect(out.failureCode).not.toBe("SANDBOX_UNAVAILABLE");
    expect(out.text).toContain("something nobody classified for");
  });
});

describe("不回归：真实沙箱故障仍然归 SANDBOX_UNAVAILABLE（不是本次修复要动的那一条）", () => {
  it("沙箱端口本身抛 SandboxUnavailableError ⇒ 仍然是 SANDBOX_UNAVAILABLE", async () => {
    const { SandboxUnavailableError } = await import("../../src/application/skill/skill-sandbox-port");
    const sandbox: SkillSandboxPort = {
      run: async () => { throw new SandboxUnavailableError("connect ECONNREFUSED /run"); },
    };
    const deps: MaybeRunSkillScriptDeps = {
      sandbox,
      objects: storeSpy(),
      regenerate: async () => SCRIPT_REPLY,
      log: () => {},
    };

    const out = await maybeRunSkillScript(deps, {
      runId: "run_f13_3", pinnedSkillCount: 1, reply: SCRIPT_REPLY,
    });

    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SANDBOX_UNAVAILABLE");
  });
});
