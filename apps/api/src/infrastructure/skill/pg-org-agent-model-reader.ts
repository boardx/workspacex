/**
 * 人类反馈（2026-08-17，两次）：skill/agent 试跑在 devapp 上仍然报 `MODEL_UNAVAILABLE`。
 *
 * ## 第一版自愈式回退有一个真实 bug——这一版修的就是它
 *
 * 第一版无条件借用"这个组织随便哪个已发布 agent"的 `model_provider`/`model_id`。
 * 但 #740 之后，`createAgent`（从零新建）与 `selfPublishToollessAgent`（#660 自助发布）
 * 落库的 agent 版本 `model_provider` **恒为** `"deep-agent"`（`resolveDeepAgentModel()`，
 * 见 `pg-default-agent-repository.ts` 头注）——那是一个走独立 LangGraph 微服务
 * （`apps/deep-agent-service`）的 provider，不是 `RoutingModelCallPort` 能直接拿普通
 * `system`/`user`/`history` 单轮补全喂给它的通用 provider。第一版查到这样一行时
 * 会"看起来找到了模型"，实际调用 `deps.model.complete()` 时必然失败
 * （要么 baseUrl 未配、要么根本不是它能应答的语义），被 catch 块转译成同一个
 * `MODEL_UNAVAILABLE`——症状不变，只是从"查不到模型"变成"查到一个必然打不通的模型"，
 * 人类完全看不出差异。
 *
 * ⇒ 这一版只信任 `RoutingModelCallPort` 里那个**唯一通用**的 provider
 *   （`readModelProviderConfig().provider`，即 `ConfiguredModelProvider`，
 *   `KERNEL_MODEL_PROVIDER`/`_BASE_URL`/`_API_KEY` 配的那一个）——`deep-agent`/
 *   `deep-research`/`bailian-image` 三个专用 provider 都不接受这种通用单轮调用，
 *   一律排除。构造函数收一个 `genericProvider` 参数，由 `kernel.module.ts` 传入
 *   与 `RoutingModelCallPort` 注册表**同一个**读法（`readModelProviderConfig()`），
 *   不在这里重新声明一份会漂移的 provider 名字符串。
 *
 * ## 这修的是哪一半，没修的是哪一半
 *
 * 修的：不再把一个保证打不通的 provider 伪装成"找到了"。
 * 没修、也修不了的：如果这个组织**所有**已发布 agent 都是 `deep-agent`
 * （目前 `createAgent`/`selfPublishToollessAgent`/默认 agent 三条路径全部如此，
 * 只有 agent-starter-import 的包可能带别的 provider），这条回退会查到 0 行，
 * 与静态 `KERNEL_SKILL_TRIALRUN_MODEL_ID` 一样退回诚实的 `MODEL_UNAVAILABLE`。
 * 这不是本文件能修的 bug——是 devapp 部署缺一个真正能用的 `modelId`
 * （`KERNEL_SKILL_TRIALRUN_MODEL_ID` 从未被设置过），需要有 VM 部署权限的人配置，
 * 已在 issue 里如实报告，不在这里猜一个没验证过的模型 id 冒充"修好了"。
 *
 * ## 为什么不直接查 `PgPublishedAgentReader`
 *
 * 那个类要一个具体 `agentId`；试跑发生在 skill 编辑器上，压根不知道该用哪个 agent——
 * 这里要的是"这个组织**随便哪个**用得上的已发布 agent 的模型"，是一条新的、更宽的
 * 查询，不是收窄参数就能复用的同一条。
 *
 * ## 为什么选"最近发布的那个"而不是"第一个"
 *
 * 组织可能同时有历史遗留的、模型早就下线的旧 agent。最近发布的那个最可能是
 * 目前实际还在被使用、模型配置仍然有效的那个——这是一个启发式，不是保证，
 * 所以 `KERNEL_SKILL_TRIALRUN_MODEL_ID`/诚实报 `MODEL_UNAVAILABLE` 仍然是兜底路径，
 * 不是被这条回退取代。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { OrgAgentModel, OrgAgentModelReader } from "../../application/skill/trial-run-skill";

interface Row {
  readonly model_provider: string;
  readonly model_id: string;
}

export class PgOrgAgentModelReader implements OrgAgentModelReader {
  /**
   * `genericProvider`：`RoutingModelCallPort` 里那个能接普通单轮补全的 provider 名字
   * （`readModelProviderConfig().provider`）。只借用 pin 着**这一个**名字的 agent 版本——
   * `deep-agent`/`deep-research`/`bailian-image` 都不是它能服务的语义，见文件头注。
   */
  constructor(
    private readonly db: DatabasePort,
    private readonly genericProvider: string,
  ) {}

  async findAnyPublished(orgId: string): Promise<OrgAgentModel | null> {
    // 空字符串表示这条部署压根没配通用 provider——不查，直接诚实地"没有可借的模型"，
    // 不要让下面的 SQL 用空串去匹配。这条回退的整个前提就是"有一个通用 provider"。
    if (this.genericProvider === "") return null;
    return this.db.withTenant(toOrgId(orgId), async (session) => {
      const result = await session.query<Row>(
        `SELECT v.model_provider, v.model_id
           FROM agents a JOIN agent_versions v
             ON v.id = a.published_version_id AND v.agent_id = a.id AND v.org_id = a.org_id
          WHERE a.org_id = $1 AND a.status = 'enabled' AND v.published_at IS NOT NULL
            AND v.model_provider = $2
          ORDER BY v.published_at DESC
          LIMIT 1`,
        [orgId, this.genericProvider],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return { provider: row.model_provider, modelId: row.model_id };
    });
  }
}
