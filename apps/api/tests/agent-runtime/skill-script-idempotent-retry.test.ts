/**
 * `putOnce` 的 never-overwrite 不该把**同一个键上的重复交付**判成失败
 * （2026-09-25 原生 deep-agent 链路实测，两轮才看全）。
 *
 * ## 第一轮：以为是"字节比对"
 *
 * 真实模型十任务 Office 矩阵头一次真的走原生链路：`call_skill` 被编排层重试，沙箱
 * 第二次又跑出"同一份"文件，`agent-run-outputs/${runId}/${file.name}` 这个键第二次
 * 写入撞上 `ObjectExistsError`——`run-skill-script.ts` 没 catch 它（`collect-native-
 * outputs.ts` 早就 catch 了，同一件事只做了一半），整个 run 以 `UNKNOWN_EXECUTION_
 * ERROR` 死掉，即便文件第一次就写成功了。第一版修法是"读回来比对字节，一致才放行"。
 *
 * ## 第二轮：字节比对是个假门槛
 *
 * 那个修法看着对，实测**仍然**崩在同一个错误上。反证：同一段 pptxgenjs 脚本连跑
 * 两次，产物字节从第 11 个字符就不同——OOXML 的 core.xml 里带创建/修改时间戳，
 * pptx/docx/xlsx 永远不会字节相同。"比对字节"这道门槛精确地卡住了它本该放行的那
 * 一类情况，从没放行过一次。
 *
 * 真正该看的是**键的形状**：`runId` + 文件名天然只属于这一次 chat run，同一轮内
 * 两次写向同一个文件名，唯一合理的解释是重试或修订，不是两个互不相干的产物碰巧
 * 选中了同一个名字。所以现在**不比对内容**，撞键即视为幂等：保留先到的那一份，
 * 放行——用户体感是"文件在"，不是"哪一次尝试的文件"。
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
  const calls: string[] = [];
  return {
    calls,
    store: {
      putOnce: () => { calls.push("putOnce"); return Promise.reject(new ObjectExistsError("agent-run-outputs/run_x/deck.pptx")); },
      get: () => Promise.resolve(new Uint8Array(existing)),
      head: () => Promise.resolve({ sizeBytes: existing.length, mime: "application/octet-stream" }),
    },
  };
}

function deps(sandbox: SkillSandboxPort, objects: NonNullable<MaybeRunSkillScriptDeps["objects"]>): MaybeRunSkillScriptDeps {
  return { sandbox, objects, regenerate: async () => SCRIPT, log: () => {} } as MaybeRunSkillScriptDeps;
}

describe("同一个键上的重复交付：撞键即幂等，不比对内容", () => {
  it("重试写出**一模一样**的字节 ⇒ 放行，run 仍然成功", async () => {
    const sandbox: SkillSandboxPort = { run: async () => okResult("x") };
    const seeded = storeSeededWith("x");
    const out = await maybeRunSkillScript(deps(sandbox, seeded.store), {
      runId: "run_x", pinnedSkillCount: 1, reply: SCRIPT,
    });
    expect(out.kind).toBe("succeeded");
  });

  /*
   * 这条钉住第二轮发现的那件事：字节**不同**（真实世界里 Office 文件的常态，
   * 时间戳一直在变）也照样放行——这正是修复要解决的实际场景，不是边缘情况。
   * 反证：把 `putOnceIdempotent` 改回"抛出原错误"，这条立刻转红。
   */
  it("重试写出的字节**不同**（真实 Office 文件的常态：时间戳）⇒ 仍然放行", async () => {
    const sandbox: SkillSandboxPort = { run: async () => okResult("y-different-bytes-but-same-intent") };
    const seeded = storeSeededWith("x-original-bytes");
    const out = await maybeRunSkillScript(deps(sandbox, seeded.store), {
      runId: "run_x", pinnedSkillCount: 1, reply: SCRIPT,
    });
    expect(out.kind).toBe("succeeded");
    expect(seeded.calls).toEqual(["putOnce"]); // 只尝试写了一次，没有为了比对去读第二次
  });

  it("键不存在（正常路径）⇒ 照常直接写入，不经过撞键分支", async () => {
    const written: { key: string; bytes: Uint8Array }[] = [];
    const sandbox: SkillSandboxPort = { run: async () => okResult("z") };
    const objects = {
      putOnce: (key: string, bytes: Uint8Array) => { written.push({ key, bytes }); return Promise.resolve(); },
      get: () => Promise.resolve(null),
      head: () => Promise.resolve(null),
    };
    const out = await maybeRunSkillScript(deps(sandbox, objects), {
      runId: "run_fresh", pinnedSkillCount: 1, reply: SCRIPT,
    });
    expect(out.kind).toBe("succeeded");
    expect(written).toHaveLength(1);
    expect(written[0]!.key).toBe("agent-run-outputs/run_fresh/deck.pptx");
  });
});
