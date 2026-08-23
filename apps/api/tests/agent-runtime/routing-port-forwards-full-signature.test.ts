/**
 * 路由层签名转发的防回归（2026-08-23 UI 取证抓出的断链）。
 *
 * 事故形状：RoutingModelCallPort.completeWithProgress 只转发 (input, onProgress)，
 * 把 execute-run 传来的 onDelta 静默吞掉——token 流在生产/取证环境全断，而
 * provider 层单测直连 provider 绕过路由层，全部绿着。UI 评分第 1 项据
 * 「相邻帧正文字数相同」判 0，才顺藤摸到这里。
 *
 * 教训固化为断言：链路上每一层都要有一个测试逼它转发完整签名。
 */
import { describe, expect, it } from "vitest";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import type { ModelCallPort } from "../../src/application/agent-run/ports";

describe("RoutingModelCallPort 完整签名转发", () => {
  it("completeWithProgress 必须把 onDelta 一并转发给被路由的 provider", async () => {
    const seen: { gotOnDelta: boolean } = { gotOnDelta: false };
    const fake: ModelCallPort = {
      complete: async () => ({ text: "x" }),
      completeWithProgress: async (_input, _onProgress, onDelta) => {
        seen.gotOnDelta = typeof onDelta === "function";
        if (onDelta) await onDelta("piece");
        return { text: "done" };
      },
    };
    const router = new RoutingModelCallPort(new Map([["deep-agent", fake]]));
    const deltas: string[] = [];
    await router.completeWithProgress(
      { modelProvider: "deep-agent", modelId: "m", system: "s", user: "u" } as never,
      async () => {},
      async (d) => void deltas.push(d),
    );
    expect(seen.gotOnDelta).toBe(true);
    expect(deltas).toEqual(["piece"]);
  });
});
