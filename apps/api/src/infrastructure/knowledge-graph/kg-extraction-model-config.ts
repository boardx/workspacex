/**
 * Phase 18 F06 —— 抽取用哪个模型。
 *
 * 同 `chat/followup-suggestions-model-config.ts` 的理由：抽取是「读一条消息、回一段 JSON」的轻量元任务，
 * 走部署的标准单次补全 provider（`KERNEL_MODEL_PROVIDER`），不借用户在聊天里选的 Agent 的快照——
 * 那可能是 deep-agent，会把这次调用写进真实会话的历史。
 *
 * ⚠ 用户直接交办更正（2026-09-25，ad-hoc，在 issue #4178 的基础上再收窄一次）：`enabled`
 *   现在只回答**这次部署有没有配置抽取用的模型 provider**（`KERNEL_MODEL_PROVIDER` 非空）——
 *   纯粹的基础设施事实，没有 provider 就没有任何东西能跑抽取，这件事没法、也不该放进
 *   平台管理员可写的表里，所以它继续留在这里、继续是启动参数。
 *
 *   `KG_EXTRACTION_ENABLED` 环境变量**已从这里的判定里彻底退休，本文件不再读它，也不再
 *   作为任何 fallback**——不是因为它没用了，是因为它回答的那个问题（"这次部署要不要跑
 *   抽取"）挪了位置：现在由 `KgDeploymentExtractionSettingsPort` 落库回答，平台管理员经
 *   `PUT /platform/knowledge-graph/extraction-setting` 随时可来回切换，不必再靠改部署配置
 *   + 重启。这条路径真的在生产上卡过一次：devapp 的部署流水线坏了好几天，坏的时候没有
 *   任何办法把这个开关从关翻成开（按本项目约定，这台机器的凭据不出机器）。
 *
 *   `kg_enqueue_extraction` 触发器仍然是两道闸门都过才排队：部署具备能力（本文件的
 *   `enabled`，provider 是否配置）AND 部署开关打开了（`kg_extraction_state.enabled`，
 *   `KgDeploymentExtractionSettingsPort` 管）——issue #4178 加的组织级第三道闸门
 *   （`kg_org_extraction_settings`）不受这次改动影响。三道闸门里，只有"部署有没有配置
 *   provider"这一道还是启动参数；另外两道都已经落库、可运行期切换。
 *
 * ⚠ 接口与注入令牌的**定义**在 `application/knowledge-graph/ports.ts`（interface 层的
 *   `knowledge-graph.controller.ts` 要读 `enabled` 位，不能直接 import 这个 infrastructure 文件，
 *   ADR-020 / `lint-arch-deps.mjs`）。这里只 re-export，不重复声明第二份。
 */
export { KG_EXTRACTION_MODEL_CONFIG, type KgExtractionModelConfig } from "../../application/knowledge-graph/ports";
import type { KgExtractionModelConfig } from "../../application/knowledge-graph/ports";

export function readKgExtractionModelConfig(env: NodeJS.ProcessEnv = process.env): KgExtractionModelConfig {
  const provider = (env.KERNEL_MODEL_PROVIDER ?? "").trim();
  return {
    enabled: provider.length > 0,
    provider,
    modelId: (
      env.KERNEL_KG_EXTRACTION_MODEL_ID ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? env.KERNEL_MODEL_ID ?? "default"
    ).trim() || "default",
  };
}
