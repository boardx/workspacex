/**
 * 本地版必须真的把思考关掉——这条链断了应用会**完全没有输出**（#3872 维度 4）。
 *
 * ## 实测（2026-09-23，安装版自带的 Ollama，空闲机器，qwen3.5:4b-mlx）
 *
 * | | 首 token | 吞吐 |
 * | --- | --- | --- |
 * | `reasoning_effort:"none"`（应用实际发的） | 冷 **1.84s** / 温 **0.08s** | 34 tok/s |
 * | 不发（对照组） | **从未出现**：1200 token 预算、36 秒，0 段可见内容 | — |
 *
 * 所以这不是「慢一点」：思考的 token 不作为可见内容吐出来，用户看到的是一个
 * **一直在转但永远不出字**的聊天框。评分卡十大缺陷里最严重的那一条就是这个形状。
 *
 * ## 为什么要在这里再加一道
 *
 * `apps/api` 那边已经有 `configured-model-provider-reasoning-effort.test.ts`，
 * 它用回环服务器在**线上取证**，证明「配了就会发」。但它证明不了「本地版配了」——
 * 把 `config.ts` 里那一行删掉，那个测试照样全绿，而本地版当场变哑。
 * 一条链上的两个环节要各自有门，否则断的那一环永远是没人看的那一环。
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelEnv, resolveLocalConfig } from "../src/config";

/** 真的仓库根——`resolveLocalConfig` 会校验 apps/api 在不在，假路径过不去。 */
const REPO_ROOT = join(__dirname, "..", "..", "..");

const env = (): Record<string, string> =>
  modelEnv(resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: mkdtempSync(join(tmpdir(), "wsx-think-")) })) as Record<string, string>;

describe("本地版的思考开关", () => {
  it("KERNEL_MODEL_REASONING_EFFORT = none", () => {
    expect(env().KERNEL_MODEL_REASONING_EFFORT).toBe("none");
  });

  it("聊天模型与元模型都在「关思考」名单里", () => {
    const e = env();
    const ids = (e.KERNEL_MODEL_THINKING_DISABLE_IDS ?? "").split(",").filter(Boolean);
    expect(ids).toContain(e.KERNEL_DEFAULT_AGENT_MODEL_ID);
    expect(ids.length).toBeGreaterThanOrEqual(2);   // 聊天 + 元任务，少一个就有一条路会思考
  });

  it("**流式是开着的**——关思考之后首 token 才有意义", () => {
    // 非流式下「首 token」等于「全程」，1.84s 这个数就不成立了。
    expect(env().KERNEL_MODEL_STREAM_ENABLED).toBe("1");
  });
});
