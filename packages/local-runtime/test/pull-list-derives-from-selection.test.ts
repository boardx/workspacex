/**
 * 拉取清单必须从选型函数派生——否则去掉一个随包模型就会触发几 GB 的下载（#3872 R19）。
 *
 * ## 这一类已经发生两次
 *
 * 1. **2026-09-22**：元模型从 Mac 包里去掉之后，每次首次启动都拉 **2.6 GB** 去换一个
 *    机器随后会拒绝使用的东西（用户实测：首次启动卡在「检查本地模型」7 分钟）。
 *    当时的修法是把它从清单里删掉——症状治了，根因没治。
 * 2. **2026-09-24**：GGUF 从 mac-arm64 包里去掉（体积优先的人类决策）之后，包里只有
 *    `qwen3.5:4b-mlx`，而拉取步骤按 `c.chatModel`（= `qwen3.5:4b`）判断「没有」，
 *    于是**开始从网上下载 3.2 GB**——把「模型随包、零网络首次运行」的目的整个抹掉。
 *    实测日志：`[ollama] 拉取 qwen3.5:4b 10%（0.3/3.2 GB）`。
 *
 * 根因两次都是同一个：**「需要哪些模型」被声明在两处**——选型函数一处，拉取清单一处。
 * 本仓头号病。这道门钉的是「只有一处」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_MODEL, MLX_SUFFIX, preferredChatModel } from "../src/config";

const UP = readFileSync(join(__dirname, "..", "src", "up.ts"), "utf8");

/** 拉取那一段：从 `opts.pullModel !== false` 到它的循环结束。 */
function pullBlock(): string {
  const i = UP.indexOf("if (opts.pullModel !== false)");
  expect(i, "up.ts 里找不到拉取步骤").toBeGreaterThan(-1);
  return UP.slice(i, i + 2600);
}

describe("拉取清单", () => {
  it("**先跑选型函数，再决定拉什么**", () => {
    const b = pullBlock();
    const sel = b.indexOf("preferredChatModel(");
    const loop = b.indexOf("for (const model of");
    expect(sel, "拉取步骤里没有调用 preferredChatModel").toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    expect(sel, "选型必须在拉取循环之前").toBeLessThan(loop);
  });

  it("循环里拉的是选型结果，不是配置值", () => {
    const b = pullBlock();
    const loopLine = b.slice(b.indexOf("for (const model of"), b.indexOf("for (const model of") + 120);
    expect(loopLine, "还在直接拉 c.chatModel——那是第二处「需要什么」的声明").not.toMatch(/\[\s*c\.chatModel/);
  });

  it("行为判据：`-mlx` 已在时，选型不会再要求那个 GGUF 标签", () => {
    // 这一条不看源码看行为：包里只有 mlx 变体时，选型必须返回 mlx，
    // 于是 `hasModel` 命中、不触发下载。
    const chosen = preferredChatModel({
      configured: DEFAULT_CHAT_MODEL,
      memoryGb: 16,
      present: [`${DEFAULT_CHAT_MODEL}${MLX_SUFFIX}`, "qwen3-embedding:0.6b"],
      appleSilicon: true,
    });
    expect(chosen).toBe(`${DEFAULT_CHAT_MODEL}${MLX_SUFFIX}`);
  });

  it("两个都不在时才该拉——退回配置值", () => {
    const chosen = preferredChatModel({
      configured: DEFAULT_CHAT_MODEL, memoryGb: 16, present: ["qwen3-embedding:0.6b"], appleSilicon: true,
    });
    expect(chosen).toBe(DEFAULT_CHAT_MODEL);
  });
});
