/**
 * #798 hotfix -- `RoutingModelCallPort.completeWithProgress`/`supportsProgress`.
 *
 * Regression coverage for the bug this hotfix found: before these methods existed, the
 * router exposed no `completeWithProgress` at all, so `execute-run.ts`'s presence check
 * never saw it and every `DeepAgentModelProvider` run silently downgraded to a plain
 * `complete()` call in production -- the tool-call progress events `completeWithProgress`
 * exists to report never fired outside unit tests that hand `execute-run.ts` a fake port
 * directly (`execute-run-progress.test.ts`). See `routing-model-call-port.ts`'s own doc
 * comment on `completeWithProgress` for why the naive fix (expose it unconditionally, same
 * as `completeStream`) is wrong: it would make EVERY run -- including chat runs pinned to
 * a provider that only supports `completeStream` -- take the progress branch and silently
 * drop real token-streaming deltas. `supportsProgress` is the per-run gate that prevents
 * that; these tests cover both halves.
 */
import { describe, expect, it } from "vitest";
import { RoutingModelCallPort } from "../../src/infrastructure/agent-run/routing-model-call-port";
import { ModelCallError, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";

const input: ModelCallInput = { modelProvider: "deep-agent-fake", modelId: "m1", system: "s", user: "u" };

describe("RoutingModelCallPort.completeWithProgress / supportsProgress", () => {
  it("转发到支持 progress 的 port，事件逐条被上报", async () => {
    const progressing: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      completeWithProgress: async (_i, onProgress) => {
        await onProgress({ toolName: "call_skill", toolArgsSummary: "{}", toolResultSummary: "r", planningNote: null });
        return { text: "done" };
      },
    };
    const router = new RoutingModelCallPort(new Map([["deep-agent-fake", progressing]]));
    expect(router.supportsProgress("deep-agent-fake")).toBe(true);
    const seen: string[] = [];
    const result = await router.completeWithProgress(input, async (e) => { seen.push(e.toolName); });
    expect(seen).toEqual(["call_skill"]);
    expect(result.text).toBe("done");
  });

  it("路由到的 port 只支持 completeStream（今天的聊天 provider）：supportsProgress 报 false，router 不会替它吞掉流式 delta", async () => {
    const streamOnly: ModelCallPort = {
      complete: async () => { throw new Error("must not be called"); },
      completeStream: async (_i, onDelta) => {
        await onDelta("real streaming delta");
        return { text: "streamed" };
      },
    };
    const router = new RoutingModelCallPort(new Map([["deep-agent-fake", streamOnly]]));
    // This is the exact regression this hotfix fixes: `supportsProgress` must say `false`
    // here so `execute-run.ts` takes the `completeStream` branch instead and the real delta
    // above is not silently discarded by a naive `completeWithProgress` fallback.
    expect(router.supportsProgress("deep-agent-fake")).toBe(false);
  });

  it("provider 未注册：supportsProgress 报 false，completeWithProgress 拒绝 MODEL_PROVIDER_NOT_CONFIGURED", async () => {
    const router = new RoutingModelCallPort(new Map());
    expect(router.supportsProgress("nobody-registered")).toBe(false);
    await expect(
      router.completeWithProgress(input, async () => {}),
    ).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" });
  });

  it("调用者违反 supportsProgress 的合同（路由到一个不支持 progress 的 port 上硬调用）：明确失败而不是静默退化", async () => {
    const noProgress: ModelCallPort = { complete: async () => ({ text: "x" }) };
    const router = new RoutingModelCallPort(new Map([["deep-agent-fake", noProgress]]));
    await expect(
      router.completeWithProgress(input, async () => {}),
    ).rejects.toBeInstanceOf(ModelCallError);
  });
});
