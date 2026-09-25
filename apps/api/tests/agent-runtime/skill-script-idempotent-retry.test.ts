/**
 * `putOnce` 的 never-overwrite 不该把**成功的重试**判成失败（2026-09-25 原生
 * deep-agent 链路实测）。
 *
 * ## 量到的代价
 *
 * 真实模型十任务 Office 矩阵头一次真的走原生 `deep-agent-service` 链路（之前一直是
 * legacy call_skill/run_script）：`call_skill` 工具调用被编排层重试，沙箱第二次真的
 * 又跑出**同一份**文件，`agent-run-outputs/${runId}/${file.name}` 这个键第二次写入时
 * 撞上 `ObjectExistsError`——而这条路径此前没有 catch 它（`collect-native-outputs.ts`
 * 早就 catch 了，`run-skill-script.ts` 没有，同一件事只做了一半），于是整个 run 以
 * `UNKNOWN_EXECUTION_ERROR` 死掉，即便文件其实第一次就写成功了。legacy 路径没有这层
 * 重试，这个坑只在原生链路上才踩得到。
 *
 * ## 修法与它的边界
 *
 * 撞键时读回已有内容比对：**字节相同** ⇒ 当作已经写过，放行；**字节不同** ⇒ 保留原有
 * 硬失败——同一个 runId 里两份不同内容抢同一个文件名，仍然是要说清楚的真实冲突，不能
 * 悄悄只留下先到的那一份。下面两条用例各钉一边。
 */
import { describe, expect, it } from "vitest";
import { maybeRunSkillScript, type MaybeRunSkillScriptDeps } from "../../src/application/agent-run/run-skill-script";
import { ObjectExistsError } from "../../src/application/artifact/ports";
import type { SandboxRunResult, SkillSandboxPort } from "../../src/application/skill/skill-sandbox-port";

const SCRIPT = [
  "```run_script",
  "const fs = require('fs');",
  "fs.writeFileSync(process.env.SKILL_SANDBOX_OUT_DIR + '/deck.pptx', 'x');",
  "```",
].join("\n");

function okResult(bytes: string): SandboxRunResult {
  return {
    exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 5,
    files: [{ name: "deck.pptx", contentBase64: Buffer.from(bytes).toString("base64"), sizeBytes: bytes.length }],
  };
}

/** 一个键上已经"存在"某份字节的存储替身——模拟重试发生前那次已经成功的写入。 */
function storeSeededWith(existingBytes: string) {
  const existing = Buffer.from(existingBytes);
  return {
    putOnce: () => Promise.reject(new ObjectExistsError("agent-run-outputs/run_x/deck.pptx")),
    get: () => Promise.resolve(new Uint8Array(existing)),
    head: () => Promise.resolve({ sizeBytes: existing.length, mime: "application/octet-stream" }),
  };
}

function deps(sandbox: SkillSandboxPort, objects: ReturnType<typeof storeSeededWith>): MaybeRunSkillScriptDeps {
  return { sandbox, objects, regenerate: async () => SCRIPT, log: () => {} } as MaybeRunSkillScriptDeps;
}

describe("同键重复写入：同内容放行，不同内容仍然硬失败", () => {
  it("重试写出**一模一样**的字节 ⇒ 当作已经写过，run 仍然成功", async () => {
    const sandbox: SkillSandboxPort = { run: async () => okResult("x") };
    const objects = storeSeededWith("x");
    const out = await maybeRunSkillScript(deps(sandbox, objects), {
      runId: "run_x", pinnedSkillCount: 1, reply: SCRIPT,
    });
    expect(out.kind).toBe("succeeded");
  });

  /*
   * 反证：把「读回来比对」这一步删掉、直接放行，这条用例就会假绿（真正的撞键也会被
   * 悄悄吞掉）。这里用不同字节逼一次真正的冲突，钉住比对没有被跳过。
   */
  it("同名但字节**不同** ⇒ 不是重试，是真撞键，仍然抛出去", async () => {
    const sandbox: SkillSandboxPort = { run: async () => okResult("y-different-bytes") };
    const objects = storeSeededWith("x");
    const out = await maybeRunSkillScript(deps(sandbox, objects), {
      runId: "run_x", pinnedSkillCount: 1, reply: SCRIPT,
    });
    expect(out.kind).toBe("failed");
  });
});
