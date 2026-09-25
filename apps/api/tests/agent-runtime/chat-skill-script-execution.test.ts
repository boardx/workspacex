/**
 * #1624 —— chat 里挂了 skill 之后，模型写出来的脚本**真的被执行**这一段的单元门控。
 *
 * 覆盖 T3（触发判据）与 T4（失败诚实）。T2（不注入沙箱 ⇒ 与今天逐字节相同）由本文件的
 * 「零依赖」一组 + `execute-run` 既有全套测试共同保证：这里证明助手函数本身不碰沙箱，
 * 既有 `execute-run` 测试证明它接进去之后仍然不改变任何已有断言。
 *
 * ## 每条门控都配了会红的反证
 *
 * 本仓已九次栽在「全绿但空转」。每个 describe 末尾的 `*-CP` 用例把判据/文案按"错误实现"
 * 的样子重放一遍，断言它**确实不满足**当前断言——也就是说，如果实现退化成那个样子，
 * 上面那条就会红。
 */
import { describe, expect, it } from "vitest";
import {
  maybeRunSkillScript,
  type MaybeRunSkillScriptDeps,
} from "../../src/application/agent-run/run-skill-script";
import {
  SandboxUnavailableError,
  type SandboxRunResult,
  type SkillSandboxPort,
} from "../../src/application/skill/skill-sandbox-port";

const SCRIPT_REPLY = [
  "好的，我来生成这个 deck。",
  "",
  "```run_script",
  "const fs = require('fs');",
  "fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/deck.pptx', 'x');",
  "```",
].join("\n");

const PROSE_REPLY = "我可以帮你把要点整理成一份演示文稿的大纲，你想讲几页？";

function okResult(over: Partial<SandboxRunResult> = {}): SandboxRunResult {
  return {
    exitCode: 0, stdout: "", stderr: "", files: [], timedOut: false, durationMs: 5, ...over,
  };
}

/**
 * 退出码 0 **且真的写了文件**的沙箱结果。
 *
 * ⚠ `okResult()`（默认 `files: []`）不再等价于"这次成功了"——`f2e246483`
 *   （2026-09-24 真实模型实测：脚本退出码 0、界面全程无错误横幅，产出文件数为 0，
 *   用户却什么也没拿到）之后，`runScriptWithRetries` 把"退出码 0 但没写文件"按
 *   可纠正的失败处理：回喂重试，重试用尽仍空则抛 `ScriptProducedNoFilesError`（见
 *   `tests/skill/script-exit-zero-without-files.test.ts`，那份规范是权威）。
 *   本文件早于那次修复（`f9afc3d63` vs `f2e246483`），凡是想验证"这次真的成功了"
 *   的用例都必须用**这个**替身，不能再用空文件的 `okResult()` 冒充成功。
 */
function okFileResult(over: Partial<SandboxRunResult> = {}): SandboxRunResult {
  return okResult({
    files: [{ name: "deck.pptx", contentBase64: Buffer.from("PKfake").toString("base64"), sizeBytes: 7 }],
    ...over,
  });
}

/** 记录被调用次数的沙箱替身——T3 断言的是"一次都没被调用"。 */
function countingSandbox(result: SandboxRunResult): { port: SkillSandboxPort; calls: () => number } {
  let calls = 0;
  return {
    port: { run: async () => { calls += 1; return result; } },
    calls: () => calls,
  };
}

function storeSpy(): { store: { putOnce: (k: string, b: Uint8Array, m: string) => Promise<void> }; keys: string[] } {
  const keys: string[] = [];
  return {
    store: { putOnce: async (k) => { keys.push(k); } },
    keys,
  };
}

function deps(over: Partial<MaybeRunSkillScriptDeps> = {}): MaybeRunSkillScriptDeps {
  return {
    regenerate: async () => SCRIPT_REPLY,
    log: () => {},
    ...over,
  } as MaybeRunSkillScriptDeps;
}

describe("T3 触发判据：三条同时成立才执行", () => {
  it("没挂 skill ⇒ 沙箱一次都不被调用", async () => {
    const sb = countingSandbox(okResult());
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never }),
      { runId: "run_1", pinnedSkillCount: 0, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("not_attempted");
    expect(sb.calls()).toBe(0);
    // 原文一个字都没被改。
    expect(out.text).toBe(SCRIPT_REPLY);
  });

  it("同一轮的 Word 和 PPT 技能脚本都执行并交付", async () => {
    const docx = SCRIPT_REPLY.replace("deck.pptx", "report.docx");
    const calls: string[] = [];
    const sandbox: SkillSandboxPort = {
      run: async ({ script }) => {
        calls.push(script);
        const name = script.includes("report.docx") ? "report.docx" : "deck.pptx";
        return okResult({
          files: [{ name, contentBase64: Buffer.from("PK\u0003\u0004fake").toString("base64"), sizeBytes: 7 }],
        });
      },
    };
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox, objects: spy.store as never }),
      { runId: "run_multi_office", pinnedSkillCount: 2, reply: PROSE_REPLY, scriptSources: [docx, SCRIPT_REPLY] },
    );

    expect(out.kind).toBe("succeeded");
    if (out.kind !== "succeeded") throw new Error("unreachable");
    expect(calls).toHaveLength(2);
    expect(out.files.map((file) => file.name)).toEqual(["report.docx", "deck.pptx"]);
    expect(spy.keys).toEqual([
      "agent-run-outputs/run_multi_office/report.docx",
      "agent-run-outputs/run_multi_office/deck.pptx",
    ]);
    expect(out.attempts).toBe(2);
  });

  it("编排回复重复了工具脚本时只执行一次", async () => {
    const sb = countingSandbox(okFileResult());
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never }),
      { runId: "run_deduped", pinnedSkillCount: 1, reply: SCRIPT_REPLY, scriptSources: [SCRIPT_REPLY] },
    );
    expect(out.kind).toBe("succeeded");
    expect(sb.calls()).toBe(1);
  });

  it("挂了 skill 但回复里没有脚本块 ⇒ 沙箱一次都不被调用", async () => {
    const sb = countingSandbox(okResult());
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never }),
      { runId: "run_2", pinnedSkillCount: 1, reply: PROSE_REPLY },
    );
    expect(out.kind).toBe("not_attempted");
    expect(sb.calls()).toBe(0);
    expect(out.text).toBe(PROSE_REPLY);
  });

  it("挂了 skill 且回复里有脚本 ⇒ 执行，且产物字节落对象存储", async () => {
    const sb = countingSandbox(okResult({
      files: [{ name: "deck.pptx", contentBase64: Buffer.from("PKfake").toString("base64"), sizeBytes: 7 }],
    }));
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never }),
      { runId: "run_3", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("succeeded");
    expect(sb.calls()).toBe(1);
    expect(spy.keys).toEqual(["agent-run-outputs/run_3/deck.pptx"]);
    if (out.kind !== "succeeded") throw new Error("unreachable");
    expect(out.files[0]!.mime)
      .toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    // 模型原文保留（审计：outputDigest 指向的文本里还找得到那段脚本）。
    expect(out.text).toContain("```run_script");
  });

  it("T3-CP 反证：判据若退化成『恒真』，上面两条必红——这里证明那两次输入确实带着可执行块/未挂 skill", async () => {
    // 恒真实现 = 直接把同样的输入交给执行循环。用同一个沙箱替身重放：
    const sb = countingSandbox(okFileResult());
    const spy = storeSpy();
    // ① 「没挂 skill」那条输入本身是**含脚本的**——所以恒真判据会真的去跑它。
    const forced = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never }),
      { runId: "cp_1", pinnedSkillCount: 1, reply: SCRIPT_REPLY }, // 只把 skill 数改成 1
    );
    expect(forced.kind).not.toBe("not_attempted");
    expect(sb.calls()).toBe(1); // ⇒ 第一条的 `toBe(0)` 在恒真实现下会失败
  });

  it("T2 不回归：沙箱端口不注入 ⇒ 原样返回，`objects` 也不被碰", async () => {
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ objects: spy.store as never }), // 只给 objects，不给 sandbox
      { runId: "run_4", pinnedSkillCount: 3, reply: SCRIPT_REPLY },
    );
    expect(out).toEqual({ kind: "not_attempted", text: SCRIPT_REPLY, files: [] });
    expect(spy.keys).toEqual([]);
  });
});

describe("T4 失败诚实：真实 stderr 出现，且不翻译成「请重试」", () => {
  const REAL_STDERR = "ReferenceError: PptxGenJS is not defined\n    at Object.<anonymous> (/w/s.js:3:1)";

  it("脚本恒失败 ⇒ 消息里带真实 stderr 原文，且不出现「请重试」", async () => {
    const sandbox: SkillSandboxPort = {
      run: async () => okResult({ exitCode: 1, stderr: REAL_STDERR }),
    };
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox, objects: spy.store as never, maxAttempts: 2 }),
      { runId: "run_5", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SCRIPT_FAILED_AFTER_RETRIES");
    // 真因逐字出现。
    expect(out.text).toContain("ReferenceError: PptxGenJS is not defined");
    expect(out.text).toContain("/w/s.js:3:1");
    // ⚠ 这条是 #660 / #1611 的落点：安慰话不许出现。
    expect(out.text).not.toMatch(/请重试|please try again/i);
    expect(out.files).toEqual([]);
  });

  it("沙箱不可达 ⇒ 与「脚本写错了」区分开，不消耗重试", async () => {
    let calls = 0;
    const sandbox: SkillSandboxPort = {
      run: async () => { calls += 1; throw new SandboxUnavailableError("connect ECONNREFUSED /run"); },
    };
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox, objects: spy.store as never }),
      { runId: "run_6", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SANDBOX_UNAVAILABLE");
    expect(calls).toBe(1); // 运维故障不该被重试三次然后报成"模型写不对"
    expect(out.text).toContain("ECONNREFUSED");
  });

  it("T4-CP 反证：把文案换成「生成失败，请重试」⇒ 上面那条断言必红", () => {
    const bad = "生成失败，请重试";
    expect(bad).toMatch(/请重试|please try again/i);      // 会被 not.toMatch 抓住
    expect(bad).not.toContain("ReferenceError");           // 真因确实被销毁了
  });

  it("退出码 0 但没写文件 ⇒ 不谎称产出", async () => {
    // ⚠ 2026-09-24 起（`f2e246483`）"退出码 0 但没写文件"不再被当成成功——那正是
    //   真实模型事故的那一幕（界面无错误横幅、产出数为 0、用户却被告知一切正常）。
    //   `runScriptWithRetries` 把它按可纠正的失败处理：回喂重试，重试用尽仍空则抛
    //   `ScriptProducedNoFilesError`（见 `tests/skill/script-exit-zero-without-files.test.ts`，
    //   那份规范是权威）。本用例原先断言 `kind: "succeeded"` 是本文件晚于那次修复才
    //   暴露出的过期断言——"不谎称产出"现在是通过诚实地报 `kind: "failed"` 做到的，
    //   不是通过在 `succeeded` 里掖一句免责声明。
    const sandbox: SkillSandboxPort = { run: async () => okResult({ files: [] }) };
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox, objects: spy.store as never }),
      { runId: "run_7", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("failed");
    if (out.kind !== "failed") throw new Error("unreachable");
    expect(out.failureCode).toBe("SCRIPT_PRODUCED_NO_FILES");
    expect(out.text).toContain("没有写出任何文件");
    expect(out.files).toEqual([]);
  });
});

describe("回喂重试：第 1 次复用已有回复，不额外调模型", () => {
  it("首次成功 ⇒ regenerate 一次都不被调用", async () => {
    let regenCalls = 0;
    // ⚠ 必须是**真的写了文件**的成功（见 `okFileResult` 头注）——空文件的 `okResult()`
    //   自 `f2e246483` 起不再算"首次成功"，会触发回喂重试，这条用例就验证不到它的标题
    //   说的那件事了。
    const sandbox: SkillSandboxPort = { run: async () => okFileResult() };
    const spy = storeSpy();
    await maybeRunSkillScript(
      deps({
        sandbox, objects: spy.store as never,
        regenerate: async () => { regenCalls += 1; return SCRIPT_REPLY; },
      }),
      { runId: "run_8", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(regenCalls).toBe(0);
  });

  it("第 1 次失败 ⇒ 第 2 次才调模型，且回喂里带着真实 exitCode/stderr", async () => {
    const feedbacks: string[] = [];
    let runs = 0;
    const sandbox: SkillSandboxPort = {
      run: async () => {
        runs += 1;
        // ⚠ 第 2 次必须**真的写文件**（见 `okFileResult` 头注）——空文件的 `okResult()`
        //   自 `f2e246483` 起不再算成功，会被判成 `SCRIPT_PRODUCED_NO_FILES` 继续重试，
        //   这条用例就验证不到"第 2 次才调模型、随后成功"这件事了。
        return runs === 1 ? okResult({ exitCode: 7, stderr: "boom-42" }) : okFileResult();
      },
    };
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({
        sandbox, objects: spy.store as never,
        regenerate: async (fb) => { feedbacks.push(fb); return SCRIPT_REPLY; },
      }),
      { runId: "run_9", pinnedSkillCount: 1, reply: SCRIPT_REPLY },
    );
    expect(out.kind).toBe("succeeded");
    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0]).toContain("exit code 7");
    expect(feedbacks[0]).toContain("boom-42");
  });
});
