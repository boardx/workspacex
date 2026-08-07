import type { DatabasePort } from "../../application/ports/database.port";
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_STABLE_NAME,
  type EnsureDefaultAgentRepository,
  type EnsureDefaultAgentResult,
} from "../../application/agent/ensure-default-agent";
import { readModelProviderConfig } from "../agent-run/configured-model-provider";
import { ensureSystemAgent, type SystemAgentTemplate } from "./pg-system-agent-repository";

/**
 * 落库形状照抄 `pg-agent-starter-import-repository.ts` 已验证的"一落地即已发布"路径
 * （见 `ensure-default-agent.ts` 头注）：一行 `agents` + 一行 `agent_versions`
 * （`published_at` 非空）+ `agents.published_version_id` 指过去 + 一行
 * `capability_listings`（`id = agentId`，chat 选择器靠这个 id 相等才能真的选中并发消息）。
 *
 * `model_provider` 读部署态唯一配置的 provider（`KERNEL_MODEL_PROVIDER`，与真正执行一次
 * run 的 `ConfiguredModelProvider` 同一个读法，`readModelProviderConfig`）——run 执行时
 * 严格要求 pin 的 provider 逐字等于这个值（无 fallback，见该文件头注），默认 agent 不能
 * 自己发明一个不会被接受的值。`model_id` 未部署专门的"默认模型"配置项，允许一个可运维
 * 覆盖的 env（`KERNEL_DEFAULT_AGENT_MODEL_ID`），没配就退到一个占位符字符串——这一列本身
 * 就没有外键校验（`agent_versions.model_id` 是自由文本，见 wave2 迁移），provider 才是
 * 真正被执行侧校验的那一半。
 *
 * ⚠ 落库逻辑本身（advisory lock / 幂等检查 / 三张表怎么写）已抽到
 * `pg-system-agent-repository.ts` 的 `ensureSystemAgent`（2026-08-07，deep-research
 * agent 落地时抽的）——这里只提供模板，避免和 `pg-deep-research-agent-repository.ts`
 * 各写一份互相漂移的 SQL。这次改动是纯行为保持的重构：既有测试
 * （`default-agent-bootstrap-chat.test.ts`/`default-agent-register-path.test.ts`/
 * `default-agent-backfill.test.ts`）原样验证，一个断言没改。
 */
const DEFAULT_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: DEFAULT_AGENT_STABLE_NAME,
  name: DEFAULT_AGENT_NAME,
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  lockKey: 660,
  resolveModel: () => {
    const { provider } = readModelProviderConfig();
    const modelId = (process.env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? "").trim() || "default";
    return { provider, modelId };
  },
};

export class PgDefaultAgentRepository implements EnsureDefaultAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(input: { readonly orgId: string; readonly actorId: string; readonly now: Date }): Promise<EnsureDefaultAgentResult> {
    return ensureSystemAgent(this.db, DEFAULT_AGENT_TEMPLATE, input);
  }
}
