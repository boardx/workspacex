/**
 * #1381 —— 本地自托管模型种子数据，与 `aliyun-bailian-models.ts` **刻意分成两个文件**。
 *
 * ## 为什么不塞进同一份 `SEED_MODELS`
 *
 * `seed-aliyun-bailian-models.test.ts` 断言 `SEED_MODELS.every(m => m.kind === "closed-api")`
 * ——那条断言的产品含义是「阿里云百炼是托管 API，不是自托管权重」，往里塞一条
 * `self-hosted` 会让这条不变量失真，而不是失真的是断言。本地模型是另一类东西
 * （F51 机密路由的落点：含机密内容整轮必须走 `self-hosted`），值得有自己的清单。
 *
 * ## 端点是**占位默认值**，不是已核实的公开信息
 *
 * `aliyun-bailian-models.ts` 里每条 `endpoint` 都是阿里云公开文档给的真实地址；本文件
 * 做不到同样的事——本地推理服务的端口因部署方式而异（Ollama 默认 `11434`，vLLM 常见
 * `8000`，TGI 又不同），没有一个"官方地址"可以核实。这里给的是**最常见的默认值**
 * （Ollama 的 OpenAI 兼容端点），管理员接入时必须按自己的实际部署改掉——这与前端表单
 * 「端点 / 权重路径」字段本来就要求手填是同一件事，种子脚本只是给个起点，不是终局值。
 *
 * ## `contextWindow` / `unitPrice`
 *
 * 同 `aliyun-bailian-models.ts` 的既有约定：保守占位值，不是真实规格。qwen3.5-4B 是小模型，
 * 4k~32k 上下文是常见发布形态的保守估计；`unitPrice` 恒为 0——自托管没有按 token 计费，
 * 真实成本是 GPU 摊销，不是这个字段能表达的量纲（与 `model-screen.tsx` 的 `priceLabel`
 * 对自托管模型如实显示"未定价"是同一个诚实原则）。
 */
import { registerModel } from "../../src/application/model/register-model";
import type { RegisterModelDeps, RegisterModelResult } from "../../src/application/model/register-model";
import type { RegisterModelInput } from "../../src/domain/model/registry";
import type { SeedModel } from "./aliyun-bailian-models";

/** Ollama 的 OpenAI 兼容端点默认值——最常见的本地部署方式，不是唯一方式。 */
export const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434/v1";

export const LOCAL_MODELS: readonly SeedModel[] = [
  {
    kind: "self-hosted",
    vendor: "本地部署 (Ollama/vLLM 兼容)",
    displayName: "qwen3.5-4b",
    capabilityTags: ["文本生成", "机密路由可用"],
    contextWindow: 32_000,
    unitPrice: 0,
    endpoint: OLLAMA_DEFAULT_ENDPOINT,
  },
];

export interface SeedOutcome {
  readonly displayName: string;
  readonly skipped: boolean;
  readonly result?: RegisterModelResult;
}

/**
 * 把 `LOCAL_MODELS` 逐条灌进真实 `registerModel`，与 `seedAliyunBailianModels` 同一套判重/
 * 空凭据纪律（见该函数文件头），不重复抄一份注释。
 */
export async function seedLocalModels(
  orgId: string,
  deps: RegisterModelDeps,
): Promise<readonly SeedOutcome[]> {
  const existing = await deps.repository.listForOrg(orgId);
  const existingNames = new Set(existing.map((m) => m.row.displayName));

  const outcomes: SeedOutcome[] = [];
  for (const seed of LOCAL_MODELS) {
    if (existingNames.has(seed.displayName)) {
      outcomes.push({ displayName: seed.displayName, skipped: true });
      continue;
    }
    const input: RegisterModelInput = {
      ...seed,
      shape: "single",
      complianceAttrs: [],
      credential: null,
      members: [],
    };
    const result = await registerModel(orgId, input, deps);
    outcomes.push({ displayName: seed.displayName, skipped: false, result });
  }
  return outcomes;
}
