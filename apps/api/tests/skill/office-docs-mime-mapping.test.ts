/**
 * F979(design-delta skill-office-docs-node-runtime)—— `run-skill-script.ts` 里
 * 新增的 `.docx`/`.xlsx`/`.pdf` 三条 `MIME_BY_EXTENSION` 映射,以及"docx 脚本真的
 * 报错后走重试循环"这一条集成断言。
 *
 * ## 为什么是这个范围,不是更大的范围
 *
 * `chat-skill-script-execution.test.ts`(#1624)已经把 `maybeRunSkillScript` 的
 * 触发判据/失败诚实性/对象存储落地这些逻辑,在 `.pptx` 场景下**逐条**门控过了——
 * 那套逻辑完全不感知具体是哪个 npm 库产出的文件,库名只在 MIME 映射表这一个地方
 * 出现过。真正因为 F979 而新增、之前没有任何测试覆盖到的,就是这张表的三条新条目
 * ——所以这里只补这一处,不重新跑一遍#1624 已经证明过的通用链路。
 *
 * `run-script-with-retries.test.ts` 的等价物
 * (`tests/skill/sandbox-retry-and-failure-codes.test.ts`)同理已经用完全通用的
 * scripted 沙箱替身证明过重试循环本身;这里补的第二组用例只是把"生成的脚本恰好是
 * 一份 docx 脚本、失败信息是真实的 docx/TypeError"这个具体场景走一遍,确认重试
 * 循环接的是**真实** stderr 文本,不是被某个格式特例吞掉。
 *
 * `apps/skill-sandbox/tests/produces-real-{docx,xlsx,pdf}.test.ts` 已经证明这三个
 * 库在沙箱里真的产出合法文件——那一层不重复。
 */
import { describe, expect, it } from "vitest";
import {
  maybeRunSkillScript,
  type MaybeRunSkillScriptDeps,
} from "../../src/application/agent-run/run-skill-script";
import type { SandboxRunResult, SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";

function okResult(over: Partial<SandboxRunResult> = {}): SandboxRunResult {
  return { exitCode: 0, stdout: "", stderr: "", files: [], timedOut: false, durationMs: 5, ...over };
}

function scriptedSandbox(sequence: readonly SandboxRunResult[]): { port: SkillSandboxPort; calls: () => number } {
  let n = 0;
  return {
    port: {
      run: async () => {
        const result = sequence[n] ?? sequence[sequence.length - 1]!;
        n += 1;
        return result;
      },
    },
    calls: () => n,
  };
}

function storeSpy(): { store: { putOnce: (k: string, b: Uint8Array, m: string) => Promise<void> }; keys: readonly (readonly [string, string])[] } {
  const keys: [string, string][] = [];
  return {
    store: { putOnce: async (k, _b, m) => { keys.push([k, m]); } },
    keys,
  };
}

function deps(over: Partial<MaybeRunSkillScriptDeps> = {}): MaybeRunSkillScriptDeps {
  return { regenerate: async () => "", log: () => {}, ...over } as MaybeRunSkillScriptDeps;
}

const SCRIPT_REPLY_FOR = (fileName: string): string =>
  [
    "好的，我来生成这个文件。",
    "",
    "```run_script",
    "const fs = require('fs');",
    `fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/${fileName}', 'x');`,
    "```",
  ].join("\n");

describe("F979 MIME 映射:.docx/.xlsx/.pdf 三条新条目", () => {
  const cases: readonly [string, string][] = [
    ["report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["memo.pdf", "application/pdf"],
  ];

  for (const [fileName, expectedMime] of cases) {
    it(`${fileName} 落对象存储时 mime 为 ${expectedMime}`, async () => {
      const reply = SCRIPT_REPLY_FOR(fileName);
      const sb = scriptedSandbox([
        okResult({ files: [{ name: fileName, contentBase64: Buffer.from("x").toString("base64"), sizeBytes: 1 }] }),
      ]);
      const spy = storeSpy();
      const out = await maybeRunSkillScript(
        deps({ sandbox: sb.port, objects: spy.store as never, regenerate: async () => reply }),
        { runId: `run-mime-${fileName}`, pinnedSkillCount: 1, reply },
      );
      expect(out.kind).toBe("succeeded");
      if (out.kind !== "succeeded") throw new Error("unreachable");
      expect(out.files[0]!.mime).toBe(expectedMime);
      expect(spy.keys).toEqual([[`agent-run-outputs/run-mime-${fileName}/${fileName}`, expectedMime]]);
    });
  }

  it("V1-CP 反证:未知后缀不落进这三条,mime 退化为通用二进制而不是误配三者之一", async () => {
    const reply = SCRIPT_REPLY_FOR("mystery.xyz");
    const sb = scriptedSandbox([
      okResult({ files: [{ name: "mystery.xyz", contentBase64: Buffer.from("x").toString("base64"), sizeBytes: 1 }] }),
    ]);
    const spy = storeSpy();
    const out = await maybeRunSkillScript(
      deps({ sandbox: sb.port, objects: spy.store as never, regenerate: async () => reply }),
      { runId: "run-mime-unknown", pinnedSkillCount: 1, reply },
    );
    expect(out.kind).toBe("succeeded");
    if (out.kind !== "succeeded") throw new Error("unreachable");
    // 认不出的后缀诚实地落 application/octet-stream(源码注释原话:"不知道",不猜一个
    // 像样的类型)——不是随便断言"不是那三个之一",精确钉住退化路径本身的行为。
    expect(out.files[0]!.mime).toBe("application/octet-stream");
  });
});

describe("F979 重试循环接的是真实 docx stderr,不是被格式特例吞掉", () => {
  it("第一次 docx 脚本报错,第二次带着真实 stderr 生成并成功", async () => {
    const REAL_DOCX_STDERR =
      "TypeError: HeadingLevel.HEADING_9 is not a valid heading level\n    at Object.<anonymous> (/tmp/work/script.js:4:38)";
    const failing: SandboxRunResult = {
      exitCode: 1,
      stdout: "",
      stderr: REAL_DOCX_STDERR,
      files: [],
      timedOut: false,
      durationMs: 5,
    };
    const succeeding = okResult({
      files: [{ name: "report.docx", contentBase64: Buffer.from("x").toString("base64"), sizeBytes: 1 }],
    });
    const sb = scriptedSandbox([failing, succeeding]);
    const spy = storeSpy();

    const seenFeedback: string[] = [];
    const out = await maybeRunSkillScript(
      deps({
        sandbox: sb.port,
        objects: spy.store as never,
        // `deps.regenerate` 只在失败回喂时被调(第 1 次复用已有 reply,见源码头注)——
        // 签名是 `(feedback: string) => Promise<string>`,不带 null 分支。
        regenerate: async (feedback: string) => {
          seenFeedback.push(feedback);
          return SCRIPT_REPLY_FOR("report.docx");
        },
      }),
      { runId: "run-docx-retry", pinnedSkillCount: 1, reply: SCRIPT_REPLY_FOR("report.docx") },
    );

    expect(out.kind).toBe("succeeded");
    expect(sb.calls()).toBe(2);
    // 重试时拿到的 feedback 里必须真的包含第一次的原始 stderr——不是一句糊过去的
    // "生成失败请重试"。
    expect(seenFeedback[0]).toContain("HeadingLevel.HEADING_9 is not a valid heading level");
  });
});
