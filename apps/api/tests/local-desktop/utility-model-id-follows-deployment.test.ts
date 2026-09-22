/**
 * 「辅助模型 id 跟着部署走」—— 反证的是一类**在本地形态必然失败**的写法。
 *
 * 2026-09-21 之前，Guided Research 的 outline / direction / skill 三个生成器，以及画布模板
 * 的章节建议 / 提示词试跑，都把模型 id 写成 `const ... = "qwen3.7-plus"`，只有 provider
 * 可配；契约里还有一份 `z.literal("qwen3.7-plus")`。这意味着：
 *
 *   · WorkspaceX Local 的模型池里只有 Ollama 上的 `qwen3.5:4b` ⇒ 这些能力必 404；
 *   · 云端的 personal-local 组织承诺只走本机/自托管端点（F16）⇒ 同样打不到那个模型；
 *   · 就算打得到，把 `KERNEL_MODEL_ID` 配成别的值的部署，响应会被全局 ValidationPipe
 *     判非法 → 500，因为契约把一个部署配置钉成了协议。
 *
 * 这个测试**不测模型会不会回话**（那要真模型）。它测的是唯一能机械核对的那件事：
 * 决定「用哪个模型」的只有一条链，而且那条链的答案会出现在对外响应里。
 */
import { afterEach, describe, expect, it } from "vitest";
import { canvasTemplateModelConfig } from "../../src/application/canvas/canvas-template-model-config";
import { guidedModelConfig } from "../../src/application/research/guided-model-config";
import { research as C } from "@repo/contracts";

const KEYS = [
  "KERNEL_MODEL_ID", "KERNEL_MODEL_PROVIDER",
  "KERNEL_GUIDED_RESEARCH_MODEL_ID", "KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER",
  "KERNEL_CANVAS_TEMPLATE_MODEL_ID", "KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER",
] as const;
const prior = new Map<string, string | undefined>();
function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const k of KEYS) {
    if (!prior.has(k)) prior.set(k, process.env[k]);
    const v = values[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of prior) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  prior.clear();
});

describe("auxiliary model ids follow the deployment", () => {
  it("falls back to the deployment's general model, as WorkspaceX Local needs", () => {
    setEnv({ KERNEL_MODEL_ID: "qwen3.5:4b", KERNEL_MODEL_PROVIDER: "ollama" });
    expect(guidedModelConfig()).toEqual({ id: "qwen3.5:4b", provider: "ollama" });
    expect(canvasTemplateModelConfig()).toEqual({ id: "qwen3.5:4b", provider: "ollama" });
  });

  it("still honours the dedicated overrides", () => {
    setEnv({
      KERNEL_MODEL_ID: "qwen3.5:4b", KERNEL_MODEL_PROVIDER: "ollama",
      KERNEL_GUIDED_RESEARCH_MODEL_ID: "research-model", KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER: "research-provider",
      KERNEL_CANVAS_TEMPLATE_MODEL_ID: "canvas-model", KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER: "canvas-provider",
    });
    expect(guidedModelConfig()).toEqual({ id: "research-model", provider: "research-provider" });
    expect(canvasTemplateModelConfig()).toEqual({ id: "canvas-model", provider: "canvas-provider" });
  });

  it("leaves a deployment that configures nothing behaving exactly as before", () => {
    setEnv({});
    expect(guidedModelConfig().id).toBe("qwen3.7-plus");
    expect(canvasTemplateModelConfig().id).toBe("qwen3.7-plus");
  });

  it("does not let the contract pin the model id to one deployment's value", () => {
    // 这一条是上面那三条的根：即便应用层配对了，契约若仍是 z.literal，响应照样 500。
    const meta = {
      status: "ready", version: 1, confirmedVersion: 1, contentVersionId: "v1",
      modelId: "qwen3.5:4b", modelInvocationId: "inv-1", modelOutputSchemaVersion: "s:v1",
      confirmedAt: null, updatedAt: "2026-09-21T00:00:00.000Z", errorCode: null,
    };
    expect(C.GuidedResearchNodeMeta.parse(meta).modelId).toBe("qwen3.5:4b");
    expect(() => C.GuidedResearchNodeMeta.parse({ ...meta, modelId: "" })).toThrow();

    const turn = {
      assistantMessage: "ok",
      proposal: {
        node: "brief",
        value: { topic: "本地形态", goal: "验证模型 id 跟着部署走", timeRange: "", region: "", focus: "" },
      },
      modelId: "qwen3.5:4b",
      modelInvocationId: "inv-1",
    };
    expect(C.GuidedResearchSkillTurnResponse.parse(turn).modelId).toBe("qwen3.5:4b");
    expect(() => C.GuidedResearchSkillTurnResponse.parse({ ...turn, modelId: "" })).toThrow();
  });
});
