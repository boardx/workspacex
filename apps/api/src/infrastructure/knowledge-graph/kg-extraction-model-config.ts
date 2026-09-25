/**
 * Phase 18 F06 —— 抽取用哪个模型。
 *
 * 同 `chat/followup-suggestions-model-config.ts` 的理由：抽取是「读一条消息、回一段 JSON」的轻量元任务，
 * 走部署的标准单次补全 provider（`KERNEL_MODEL_PROVIDER`），不借用户在聊天里选的 Agent 的快照——
 * 那可能是 deep-agent，会把这次调用写进真实会话的历史。
 *
 * ⚠ issue #4178 更正范围：`enabled` 现在只回答**这次部署有没有能力跑抽取**（配置了 provider
 *   且 `KG_EXTRACTION_ENABLED=1`）——这是部署级、启动时定住、不会变的事实，本文件的行为
 *   与判定逻辑一个字都没改。它**不再是**「某个组织现在是不是真的在抽」的答案：那件事从
 *   本迁移起还要看 `kg_org_extraction_settings`（每个组织自己落库、admin 可来回切换的开关，
 *   契约 `getKnowledgeExtractionSetting`/`setKnowledgeExtractionSetting`）。`kg_enqueue_extraction`
 *   触发器现在是两道闸门都过才排队：部署具备能力（本文件）AND 该组织打开了。此前 `enabled`
 *   这个名字暗示了「抽取正在跑」，但从今天起「跑不跑」还多了一个它管不到的组织维度——
 *   在这里写清楚，而不是悄悄让这个名字继续代表它已经不再代表的范围。
 *
 * **部署有没有能力**：`KG_EXTRACTION_ENABLED=1` 且配置了 provider。默认关的理由：抽取会对每条新消息
 * 额外调一次模型——在没打算用知识图谱的部署、以及大量起完整应用的集成 / e2e 测试里（它们会数模型调用），
 * 默认开等于悄悄改变了它们的行为与成本。部署没能力时新消息一律不排队（不管任何组织开没开）；
 * 部署有能力但某个组织没打开时，那个组织的新消息同样不排队——见 `kg-extraction-worker.ts` 头注。
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
    enabled: provider.length > 0 && (env.KG_EXTRACTION_ENABLED ?? "").trim() === "1",
    provider,
    modelId: (
      env.KERNEL_KG_EXTRACTION_MODEL_ID ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? env.KERNEL_MODEL_ID ?? "default"
    ).trim() || "default",
  };
}
