/**
 * issue #2893 —— 技能脚本**重试路径**遇到内核 interrupt 的归类与文案门控。
 *
 * ## 实测形态（2026-09-07，本地生产镜像矩阵，main cf5da3f50）
 *
 * pptx 脚本第一次在沙箱失败（环境缺模块）→ 回喂重试用 `complete()` 让内核重生成脚本
 * → 这次 run 停在了 interrupt（内核自己发起 `confirm_task_intent` / `fill_run_params`）
 * → `pollToTerminal` 对 `interrupted` 一律抛 `MODEL_CALL_FAILED` → 用户看到：
 *
 *     ⚠ 脚本执行失败（MODEL_CALL_FAILED），本轮**没有**产出文件。沙箱返回的真实错误输出：
 *     deep agent run ended with status "interrupted"
 *
 * 这句话里没有一个字是真的：沙箱在这一步根本没被调用，所以不是"沙箱返回的"；内核也
 * 不是失败了，是它在**等人回答一个问题**。真正外露的是一句只该进服务端日志的内部状态。
 *
 * ## 三层各钉一条，每条配会红的反证（`*-CP`）
 *
 * ① provider：`interrupted` 抛的类型与 `error`/`timeout` 可分辨（`ModelCallInterruptedError`）。
 * ② 归类：`toFailure` 把它归 `SCRIPT_RETRY_INTERRUPTED`，不是 `MODEL_CALL_FAILED`。
 * ③ 文案：用户看到的文字不出现内部状态串、也不谎称是沙箱的输出；而沙箱真的跑过的
 *    那条路径**逐字不变**（#660 / #1611 的 stderr 原文纪律不因本次修复松动）。
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  maybeRunSkillScript,
  retryScriptSource,
  type MaybeRunSkillScriptDeps,
} from "../../src/application/agent-run/run-skill-script";
import { ModelCallError, ModelCallInterruptedError } from "../../src/application/agent-run/ports";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import type { SandboxRunResult, SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";

/** 实测里内核抛出的那句内部状态——它**不得**出现在用户文案里。 */
const KERNEL_INTERRUPT_DETAIL = 'deep agent run ended with status "interrupted"';

const SCRIPT_REPLY = [
  "好的，我来生成这个 deck。",
  "",
  "```run_script",
  "const fs = require('fs');",
  "fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/deck.pptx', 'x');",
  "```",
].join("\n");

function failResult(over: Partial<SandboxRunResult> = {}): SandboxRunResult {
  return { exitCode: 1, stdout: "", stderr: "Cannot find module 'pptxgenjs'", files: [], timedOut: false, durationMs: 5, ...over };
}

// 与既有 `failure-classification.test.ts` 同一约定：本文件不测产物落盘。
function storeSpy(): MaybeRunSkillScriptDeps["objects"] {
  return { putOnce: async () => {} } as never;
}

/** 第 1 次尝试复用 reply 并失败 ⇒ 第 2 次走 `regenerate`，也就是本 issue 的那条路径。 */
async function runWithRegenerate(regenerate: MaybeRunSkillScriptDeps["regenerate"], runId: string) {
  const sandbox: SkillSandboxPort = { run: async () => failResult() };
  const logged: Record<string, unknown>[] = [];
  const out = await maybeRunSkillScript(
    { sandbox, objects: storeSpy(), regenerate, log: (_m, d) => void logged.push(d), maxAttempts: 2 },
    { runId, pinnedSkillCount: 1, reply: SCRIPT_REPLY },
  );
  return { out, logged };
}

describe("① provider：远端 interrupted 与 error/timeout 必须可分辨", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  /** 极简假内核：只认 `complete()` 那条轮询路径用到的几条路由。 */
  const startFake = (runStatus: string): Promise<string> => {
    server = createServer(async (req, res) => {
      const url = req.url ?? "";
      for await (const chunk of req) void chunk; // drain
      if (req.method === "POST" && url === "/threads") { res.writeHead(200).end(JSON.stringify({ thread_id: "t1" })); return; }
      if (req.method === "POST" && /\/threads\/t1\/runs$/.test(url)) { res.writeHead(200).end(JSON.stringify({ run_id: "r1" })); return; }
      if (req.method === "GET" && /\/runs\/r1$/.test(url)) { res.writeHead(200).end(JSON.stringify({ status: runStatus })); return; }
      res.writeHead(404).end();
    });
    return new Promise((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`);
      });
    });
  };

  const base = { modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u", history: [], skills: [] };
  const provider = (baseUrl: string) => new DeepAgentModelProvider({ baseUrl, timeoutMs: 5000, pollIntervalMs: 5 });

  it('run 停在 "interrupted" ⇒ complete() 抛的是 ModelCallInterruptedError（不是一次普通的模型调用失败）', async () => {
    const baseUrl = await startFake("interrupted");
    await expect(provider(baseUrl).complete(base as never)).rejects.toBeInstanceOf(ModelCallInterruptedError);
  });

  it("不回归：既有 catch 点看到的仍是 ModelCallError / MODEL_CALL_FAILED，detail 措辞一字未改", async () => {
    const baseUrl = await startFake("interrupted");
    await expect(provider(baseUrl).complete(base as never)).rejects.toMatchObject({
      code: "MODEL_CALL_FAILED", detail: KERNEL_INTERRUPT_DETAIL,
    });
  });

  it('①-CP 反证：run 停在 "error" 仍然只是 ModelCallError，不会被误认成中断', async () => {
    const baseUrl = await startFake("error");
    await expect(provider(baseUrl).complete(base as never)).rejects.toBeInstanceOf(ModelCallError);
    await expect(provider(baseUrl).complete(base as never)).rejects.not.toBeInstanceOf(ModelCallInterruptedError);
  });
});

describe("② 归类：重生成撞上 interrupt ⇒ SCRIPT_RETRY_INTERRUPTED，不是 MODEL_CALL_FAILED", () => {
  it("regenerate 抛 ModelCallInterruptedError ⇒ failureCode 说的是「被中断」，不是「模型调用失败」", async () => {
    const { out } = await runWithRegenerate(async () => {
      throw new ModelCallInterruptedError(KERNEL_INTERRUPT_DETAIL);
    }, "run_2893_1");

    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SCRIPT_RETRY_INTERRUPTED");
    expect(out.failureCode).not.toBe("MODEL_CALL_FAILED");
    // 这一路没有沙箱输出可报——不拿内核状态去填这个字段冒充 stderr。
    expect(out.stderr).toBe("");
  });

  it("provider 返回（而不是抛出）interrupted 摘要时，是同一个事实、同一个归类", async () => {
    const { out } = await runWithRegenerate(async () =>
      retryScriptSource({ text: "", interrupted: { toolName: "confirm_task_intent", argsSummary: null } }),
    "run_2893_2");

    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SCRIPT_RETRY_INTERRUPTED");
  });

  it("②-CP 反证：把 interrupt 当成普通模型调用失败（旧形态）⇒ 归类必然退回 MODEL_CALL_FAILED", async () => {
    const { out } = await runWithRegenerate(async () => {
      // 旧实现：provider 对 interrupted 抛的就是一个普通的 ModelCallError。
      throw new ModelCallError("MODEL_CALL_FAILED", KERNEL_INTERRUPT_DETAIL);
    }, "run_2893_3");

    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("MODEL_CALL_FAILED"); // 旧形态确实落在这里
  });

  it("不回归：真正的模型调用失败仍然归 MODEL_CALL_FAILED", async () => {
    const { out } = await runWithRegenerate(async () => {
      throw new ModelCallError("MODEL_CALL_FAILED", "upstream 500 from model provider");
    }, "run_2893_4");

    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("MODEL_CALL_FAILED");
  });
});

describe("③ 文案：用户看到的话里没有内部状态串，也不谎称是沙箱的输出", () => {
  it("中断路径：不出现内核状态原文、不出现「沙箱返回的真实错误输出」、也不是一句「请重试」", async () => {
    const { out, logged } = await runWithRegenerate(async () => {
      throw new ModelCallInterruptedError(KERNEL_INTERRUPT_DETAIL);
    }, "run_2893_5");

    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.text).not.toContain(KERNEL_INTERRUPT_DETAIL);
    expect(out.text).not.toContain("interrupted");
    expect(out.text).not.toContain("沙箱返回的真实错误输出");
    expect(out.text).not.toContain("MODEL_CALL_FAILED");
    expect(out.text).not.toMatch(/请重试|please try again/i);
    // 说出**用户能据以行动**的事实：这一轮没有产物，且中断是在等人确认。
    expect(out.text).toContain("没有**产出文件");
    expect(out.text).toContain("中断");
    // 模型原文没有被改写掉。
    expect(out.text.startsWith(SCRIPT_REPLY)).toBe(true);
    // 内部措辞不是被删掉了——它落在服务端日志里，排查的人仍然拿得到。
    expect(logged.some((d) => d.modelCallDetail === KERNEL_INTERRUPT_DETAIL)).toBe(true);
  });

  it("模型调用真的失败时：provider 原话同样不外露（`ModelCallError.detail` 是只进日志的字段）", async () => {
    const { out, logged } = await runWithRegenerate(async () => {
      throw new ModelCallError("MODEL_CALL_FAILED", "upstream 500: <prompt fragment leaked here>");
    }, "run_2893_6");

    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.text).not.toContain("prompt fragment leaked here");
    expect(out.text).not.toContain("沙箱返回的真实错误输出");
    expect(logged.some((d) => d.modelCallDetail === "upstream 500: <prompt fragment leaked here>")).toBe(true);
  });

  it("③-CP 反证：旧文案（对每一种失败都贴 stderr 字段并署名「沙箱返回」）确实会外露内部状态", () => {
    const legacyRenderFailure = (reply: string, code: string, stderr: string): string =>
      [reply, "", "---", "", `⚠ 脚本执行失败（${code}），本轮**没有**产出文件。沙箱返回的真实错误输出：`, "", "```", stderr, "```"].join("\n");

    const legacy = legacyRenderFailure(SCRIPT_REPLY, "MODEL_CALL_FAILED", KERNEL_INTERRUPT_DETAIL);
    expect(legacy).toContain(KERNEL_INTERRUPT_DETAIL);       // 内部状态被逐字抛给用户
    expect(legacy).toContain("沙箱返回的真实错误输出");        // 且被署名成沙箱的输出
  });

  it("不回归：沙箱真的跑过的失败，仍然带**真实 stderr 原文**并署名沙箱（#660 / #1611）", async () => {
    const sandbox: SkillSandboxPort = { run: async () => failResult({ stderr: "ReferenceError: pptx is not defined" }) };
    const out = await maybeRunSkillScript(
      { sandbox, objects: storeSpy(), regenerate: async () => SCRIPT_REPLY, log: () => {}, maxAttempts: 2 },
      { runId: "run_2893_7", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );

    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SCRIPT_FAILED_AFTER_RETRIES");
    expect(out.text).toContain("ReferenceError: pptx is not defined");
    expect(out.text).toContain("沙箱返回的真实错误输出");
    expect(out.text).not.toMatch(/请重试|please try again/i);
  });
});
