/**
 * #548 —— 阿里云百炼种子数据 + 导入逻辑，拆成库函数以便被 CLI 脚本与测试共用一份实现
 * （而不是测试重新抄一份清单，抄出第二个会漂移的副本）。
 *
 * 数据来源与局限：见 `../seed-aliyun-bailian-models.ts` 文件头。
 */
import { registerModel } from "../../src/application/model/register-model";
import type { RegisterModelDeps, RegisterModelResult } from "../../src/application/model/register-model";
import type { RegisterModelInput } from "../../src/domain/model/registry";

/** DashScope 兼容模式端点，公开信息（不是密钥）。ASR/TTS 走独立的 WebSocket 端点。 */
export const COMPATIBLE_MODE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const REALTIME_WS_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

export type SeedModel = Omit<RegisterModelInput, "shape" | "members" | "complianceAttrs" | "credential">;

/**
 * 阿里云百炼模型清单，2026-08-06 现场取值（人类提供，见 issue #548 背景）。
 * `contextWindow` / `unitPrice` 没有对应的现场取值，全部给保守占位值——不是真实规格，
 * 未来需要人类核实更新。
 */
export const SEED_MODELS: readonly SeedModel[] = [
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen3.8-max",
    capabilityTags: ["文本生成", "多模态理解"],
    contextWindow: 128_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen3.7-plus",
    capabilityTags: ["文本生成"],
    contextWindow: 128_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen3.7-flash",
    capabilityTags: ["文本生成"],
    contextWindow: 128_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "deepseek-v4-pro",
    capabilityTags: ["文本生成"],
    contextWindow: 128_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "glm-5.2",
    capabilityTags: ["文本生成"],
    contextWindow: 128_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen3.5-omni-plus",
    capabilityTags: ["多模态理解"],
    contextWindow: 32_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen-audio-3.0-asr-flash-streaming",
    capabilityTags: ["ASR", "流式"],
    // 语音模型无「上下文窗口」的自然对应值，契约要求正数，取保守占位。
    contextWindow: 8_000,
    unitPrice: 0,
    endpoint: REALTIME_WS_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen-audio-3.0-asr-flash-filetrans",
    capabilityTags: ["ASR", "文件转写"],
    contextWindow: 8_000,
    unitPrice: 0,
    endpoint: COMPATIBLE_MODE_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen3.5-omni-plus-realtime",
    capabilityTags: ["实时对话", "ASR"],
    contextWindow: 32_000,
    unitPrice: 0,
    endpoint: REALTIME_WS_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen-audio-3.0-realtime-plus",
    capabilityTags: ["实时对话", "ASR"],
    contextWindow: 8_000,
    unitPrice: 0,
    endpoint: REALTIME_WS_ENDPOINT,
  },
  {
    kind: "closed-api",
    vendor: "阿里云百炼 (DashScope)",
    displayName: "qwen-audio-3.0-tts-plus",
    capabilityTags: ["TTS"],
    contextWindow: 8_000,
    unitPrice: 0,
    endpoint: REALTIME_WS_ENDPOINT,
  },
];

export interface SeedOutcome {
  readonly displayName: string;
  readonly skipped: boolean;
  readonly result?: RegisterModelResult;
}

/**
 * 把 `SEED_MODELS` 逐条灌进真实 `registerModel`。按 `displayName` 判重——已存在同名模型
 * 的组织，这次运行会跳过它，不重复插入。
 *
 * 凭据全部传 `null`（敏感信息，调用方不该有真实值）；`complianceAttrs` 全部传 `[]`
 * （O-38：组织词表当前为空，非空提交必被拒）。
 */
export async function seedAliyunBailianModels(
  orgId: string,
  deps: RegisterModelDeps,
): Promise<readonly SeedOutcome[]> {
  const existing = await deps.repository.listForOrg(orgId);
  const existingNames = new Set(existing.map((m) => m.row.displayName));

  const outcomes: SeedOutcome[] = [];
  for (const seed of SEED_MODELS) {
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
