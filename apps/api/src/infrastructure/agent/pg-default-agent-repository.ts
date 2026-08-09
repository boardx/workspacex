import type { DatabasePort } from "../../application/ports/database.port";
import {
  DEFAULT_AGENT_INSTRUCTIONS,
  DEFAULT_AGENT_NAME,
  DEFAULT_AGENT_STABLE_NAME,
  type EnsureDefaultAgentRepository,
  type EnsureDefaultAgentResult,
} from "../../application/agent/ensure-default-agent";
import { DEEP_AGENT_PROVIDER_NAME } from "../agent-run/deep-agent-model-provider";
import { ensureSystemAgent, type SystemAgentTemplate } from "./pg-system-agent-repository";

/**
 * 落库形状照抄 `pg-agent-starter-import-repository.ts` 已验证的"一落地即已发布"路径
 * （见 `ensure-default-agent.ts` 头注）：一行 `agents` + 一行 `agent_versions`
 * （`published_at` 非空）+ `agents.published_version_id` 指过去 + 一行
 * `capability_listings`（`id = agentId`，chat 选择器靠这个 id 相等才能真的选中并发消息）。
 *
 * ## `model_provider` 恒为 `DEEP_AGENT_PROVIDER_NAME`（#740，替换之前的读法）
 *
 * 2026-08-08 之前，这里读部署态唯一配置的 chat provider（`KERNEL_MODEL_PROVIDER`，与
 * `ConfiguredModelProvider` 同一个读法）——默认 agent 直接对着那一个 provider 发起单次
 * chat completion。人类的决定（见 #738 调查记录）是把默认 agent 的智能执行层换成
 * `deepagents`：默认 agent 现在恒定 pin `"deep-agent"`（`DeepAgentModelProvider` 服务的
 * provider 名），不再读 `KERNEL_MODEL_PROVIDER`——这条 env 仍然存在，但只喂给
 * `ConfiguredModelProvider` 自己（那个 provider 还在，仍然是 `deep-agent-service` 内部
 * 用同一把 `KERNEL_MODEL_API_KEY` 发起真实模型调用时的底层依赖，只是默认 agent 的这次
 * run 不再直连它）。同 `ensure-deep-research-agent.ts` 的 `DEEP_RESEARCH_AGENT_PROVIDER`
 * 一样，这是一个走完全不同执行路径的常量 provider，不是"配置态可覆盖的默认值"。
 *
 * `model_id` 沿用原本的可运维覆盖机制（`KERNEL_DEFAULT_AGENT_MODEL_ID`），未配则退到
 * 占位符字符串——这一列没有外键校验，provider 才是真正被执行侧校验的那一半。
 *
 * ⚠ 存量组织（这次改动落地前已经存在、默认 agent 的 `model_provider` 还是旧值的组织）
 * 不会自动切换——`ensureSystemAgent` 只在"这个 stable_name 还不存在"时写入，已存在的
 * agent 版本不会被这个模板覆盖。迁移见 `scripts/migrate-default-agent-provider.ts`
 * （#740，同 `backfill-default-agents.ts` 的 provider 修复 pass 同一形状：发布一个新
 * 版本、`published_version_id` 指过去，`agent_versions` 保持只追加不可变）。
 *
 * 落库逻辑本身（advisory lock / 幂等检查 / 三张表怎么写）已抽到
 * `pg-system-agent-repository.ts` 的 `ensureSystemAgent`（2026-08-07，deep-research
 * agent 落地时抽的）——这里只提供模板，避免和 `pg-deep-research-agent-repository.ts`
 * 各写一份互相漂移的 SQL。
 */
/**
 * ⚠ #660 起，这个解析被**用户自助发布的 agent**（`pg-self-publish-agent-repository.ts`）
 * 复用：一个零工具零 skill 的自建 agent，其执行路径与 `通用助手` **完全相同**
 * （同一个 `deepagents` 服务、同一把 key），所以它 pin 的 provider/model 是**同一个事实**，
 * 必须只有一处声明。第二次写 `DEEP_AGENT_PROVIDER_NAME + KERNEL_DEFAULT_AGENT_MODEL_ID`
 * 就是本仓已经踩过五次的漂移形状——而漂移的后果是：默认 agent 能跑、自建 agent
 * pin 到一个不存在的 provider，且只有真的发消息才发现。
 */
export function resolveDeepAgentModel(): { readonly provider: string; readonly modelId: string } {
  const modelId = (process.env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? "").trim() || "default";
  return { provider: DEEP_AGENT_PROVIDER_NAME, modelId };
}

const DEFAULT_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: DEFAULT_AGENT_STABLE_NAME,
  name: DEFAULT_AGENT_NAME,
  abbr: "通用",
  duty: "通用对话与任务协助，新组织的默认可聊 agent",
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  lockKey: 660,
  resolveModel: resolveDeepAgentModel,
};

export class PgDefaultAgentRepository implements EnsureDefaultAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(input: { readonly orgId: string; readonly actorId: string; readonly now: Date }): Promise<EnsureDefaultAgentResult> {
    return ensureSystemAgent(this.db, DEFAULT_AGENT_TEMPLATE, input);
  }
}
