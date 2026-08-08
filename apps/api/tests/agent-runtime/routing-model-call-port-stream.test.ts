/**
 * #654 阶段2a — `RoutingModelCallPort.completeStream` 的委派语义。
 *
 * 三个场景，逐句对应 `routing-model-call-port.ts` 新增方法的文档承诺：
 *   1. 路由到的 port 自己有 `completeStream` ⇒ 转发给它，`onDelta` 真的被调用。
 *   2. 路由到的 port 没有 `completeStream`（今天的 `open-deep-research`/图片生成）⇒
 *      退回它的 `complete()`，`onDelta` 一次都不被调用，文本与非流式路径一致。
 *   3. `modelProvider` 没有注册 ⇒ `MODEL_PROVIDER_NOT_CONFIGURED`，与 `complete()`
 *      是同一个失败面，不因为走了流式入口就换一种错误。
 */
import { describe, expect, it } from "vitest";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import { ModelCallError, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";

const input: ModelCallInput = { modelProvider: "streams-fine", modelId: "m1", system: "s", user: "u" };

describe("RoutingModelCallPort.completeStream", () => {
  it("转发到支持流式的 port，onDelta 逐帧被调用", async () => {
    const streaming: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      completeStream: async (_i, onDelta) => {
        await onDelta("a");
        await onDelta("b");
        return { text: "ab" };
      },
    };
    const router = new RoutingModelCallPort(new Map([["streams-fine", streaming]]));
    const seen: string[] = [];
    const result = await router.completeStream(input, async (d) => { seen.push(d); });
    expect(seen).toEqual(["a", "b"]);
    expect(result.text).toBe("ab");
  });

  it("路由到的 port 不支持流式：退回 complete()，onDelta 一次都不被调用", async () => {
    const nonStreaming: ModelCallPort = {
      complete: async () => ({ text: "one-shot", tokens: 2 }),
    };
    const router = new RoutingModelCallPort(new Map([["streams-fine", nonStreaming]]));
    const seen: string[] = [];
    const result = await router.completeStream(input, async (d) => { seen.push(d); });
    expect(seen).toEqual([]);
    expect(result).toEqual({ text: "one-shot", tokens: 2 });
  });

  it("provider 未注册：MODEL_PROVIDER_NOT_CONFIGURED，与 complete() 同一失败面", async () => {
    const router = new RoutingModelCallPort(new Map());
    await expect(
      router.completeStream(input, async () => {}),
    ).rejects.toBeInstanceOf(ModelCallError);
    await expect(
      router.complete(input),
    ).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });
});
