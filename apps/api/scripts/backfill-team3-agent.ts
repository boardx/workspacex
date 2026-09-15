/**
 * Team3 ad-hoc MVP agent 补种脚本 —— 「前沿赛道技术路线研判」
 * （`docs/design/agent-team3-mvp-backlog.md`）。
 *
 * ## 为什么是脚本，不是迁移
 *
 * `0008-f15-capability-listings.sql` 的文件头把话说死了：**这张表的任何迁移都不许
 * INSERT**（`no-builtin-capability-lists.test.ts` 机械断言这一点）——种子数据必须走
 * 应用层真实写路径，不能从迁移文件这条静态 lint 看不到的后门塞进去。`agents`/
 * `agent_versions` 同理要跟 `capability_listings` 同一个事务原子落地（否则会出现
 * "能发消息但编制面板看不见"或反过来的半成品状态），所以这三张表只能一起走
 * `ensureSystemAgent`（`infrastructure/agent/pg-system-agent-repository.ts`）这条
 * 已验证的应用层写路径——与 `backfill-default-agents.ts` / `backfill-deep-research-agent.ts`
 * 同一形状，本脚本就是照抄那两个的结构。
 *
 * ## 为什么不是 hook 进 `auth-registration.controller.ts`
 *
 * `ensureDefaultAgent`/`ensureDeepResearchAgent` 挂在组织**创建那一刻**，对**所有
 * 未来组织**永久生效——那是"通用助手""深度研究"这类平台级默认能力该有的生命周期。
 * team3 不是：backlog 文件头人类原话「team3 是临时 Agent，后续会删除」。把它焊进共享的
 * 注册控制器，意味着删除它时要改一处所有组织注册都会走到的共享代码；而这份脚本 + 一次
 * 部署期调用是自包含的——不再需要它时，从 `deploy.sh` 摘掉这一步、（可选）执行反向
 * `DELETE`，不动任何共享控制器。
 *
 * ## 目标组织：按名字精确匹配「Workspace」
 *
 * 与 `isAgentsNavVisibleForOrg`（`apps/web/lib/navigation.ts`）判定 `/agent` 一级导航
 * 可见性用的是**同一个组织标识**（组织显示名 `"Workspace"`）。这不是"猜一个 id"——
 * `organizations.name` 是真实存在的列，本脚本按名字查，跑在哪个环境就种到哪个环境
 * 真实存在的、名字是 Workspace 的组织，不依赖硬编码 id 跨环境漂移。
 *
 * ## model_provider / model_id
 *
 * 复用「通用助手」默认 agent 已验证工作的执行路径：`DEEP_AGENT_PROVIDER_NAME`
 * （`"deep-agent"`），不直连 `ConfiguredModelProvider`/`KERNEL_MODEL_PROVIDER`——那条更窄
 * 的约束（run 的 provider 必须与部署态唯一配置的 provider 全等）是给"直连一个 OpenAI
 * 兼容端点"这类 agent 的，team3 没有理由绑它。`model_id` 复用 `resolveDeepAgentModel()`
 * 同一份解析（`KERNEL_DEFAULT_AGENT_MODEL_ID` 未设时落地 `"default"`）——不第二次声明
 * 这条 env 的读法。
 *
 * ## toolWhitelist
 *
 * `agent_versions.tool_policy` 有 CHECK 强制必须是空数组，`通用助手`/`深度研究`两个
 * 系统预置 agent 也都是如此——这张表从未支持过非空 tool_policy，真实 run 执行侧
 * （`native-invocation.ts` 的 `NATIVE_PROFILE_TOOLS`）也不按 agent 做工具准入过滤，
 * 所以这里如实跟随既有约定写空数组，不假装这一列在做它实际不做的事；PR 描述另有
 * 关于"工具收紧在这个部署实际落在哪一层"的诚实说明。
 */
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { ensureSystemAgent, type SystemAgentTemplate } from "../src/infrastructure/agent/pg-system-agent-repository";
import { resolveDeepAgentModel } from "../src/application/agent/ensure-default-agent";

export const TEAM3_AGENT_STABLE_NAME = "team3-frontier-track-research";
export const TEAM3_AGENT_NAME = "前沿赛道技术路线研判";
export const TEAM3_AGENT_INSTRUCTIONS =
  "你是本组织的「前沿赛道技术路线研判」分析助手（系统预置，MVP 版本）。\n\n" +
  "你的工作是帮助用户整理与研判前沿技术赛道（如量子计算、新能源材料等）的产业动态：" +
  "用户会粘贴或上传专家访谈转录稿、产业链研究纪要、政策汇编等原始材料，你要把它们转成" +
  "可供投资研究使用的结构化分析。请始终遵守以下分析纪律：\n\n" +
  "1. 里程碑提取：从材料中提取带时间节点的技术/产业里程碑，标注它在原文中的大致位置" +
  "（如「访谈第 X 段」「纪要第 X 部分」），不要遗漏也不要编造日期。\n" +
  "2. 原话与转述必须分开标注：凡是能在原文找到对应语句的专家判断，用引号给出原话" +
  "（可直接摘录），并说明出处；你自己的归纳、总结或转述必须明确标注为转述，不能与" +
  "原话混排导致读者分不清哪句是谁说的。\n" +
  "3. 矛盾并列，不擅自裁决：当不同材料（如企业访谈 vs 政策文件、不同专家之间）出现" +
  "相互矛盾的说法时，把矛盾双方原样并列列出，说明各自出处，不要替用户下结论「哪个" +
  "是对的」；如果你有基于材料本身的采信理由（例如时间更新、来源更权威），可以说明" +
  "理由供用户参考，但要清楚标注这是你的推断而不是事实。\n" +
  "4. 隐性风险只能从材料中已陈述的事实关联推出，不能凭空编造。找不到支撑材料时要" +
  "明确说「未在材料中找到相关信息」，而不是编一个听起来合理的答案。\n" +
  "5. 产业链材料按上中下游分层整理，政策材料按地域/层级分层整理，最后给出一段不超过" +
  "500 字的判断与建议摘要，供投研人员快速阅读。\n\n" +
  "不确定或材料信息不足以支撑结论时，直接说明信息缺口，不要用推测冒充结论。";

const TEAM3_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: TEAM3_AGENT_STABLE_NAME,
  name: TEAM3_AGENT_NAME,
  abbr: "T3",
  duty: "整理专家访谈与产业链材料，产出里程碑/原话转述分离/矛盾并列/隐性风险的结构化分析",
  roleLabel: "技术路线研判",
  instructions: TEAM3_AGENT_INSTRUCTIONS,
  // #662/#661 系两个系统 agent 已占用各自的 lock key 空间；随手挑一个不冲突的常量。
  lockKey: 0x7ea3,
  resolveModel: resolveDeepAgentModel,
};

export interface Team3BackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
}

export async function backfillTeam3Agent(): Promise<Team3BackfillReport> {
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let candidates: { orgId: string; actorId: string }[];
  let skippedNoAdmin = 0;
  try {
    const { rows } = await owner.query<{ org_id: string; actor_id: string | null }>(
      `SELECT o.id AS org_id,
              (SELECT m.user_id FROM org_memberships m
                WHERE m.org_id = o.id AND m.org_role = 'admin'
                ORDER BY m.user_id ASC LIMIT 1) AS actor_id
         FROM organizations o
        WHERE o.name = 'Workspace'
          AND NOT EXISTS (
                SELECT 1 FROM agents a
                 WHERE a.org_id = o.id AND a.stable_name = $1
              )`,
      [TEAM3_AGENT_STABLE_NAME],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
    if (skippedNoAdmin > 0) {
      console.log(`[backfill-team3-agent] skipping ${skippedNoAdmin} org(s) named Workspace with no admin member yet`);
    }
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    let created = 0;
    for (const { orgId, actorId } of candidates) {
      const r = await ensureSystemAgent(db, TEAM3_AGENT_TEMPLATE, { orgId, actorId: actorId, now: new Date() });
      if (r.created) created += 1;
      console.log(`[backfill-team3-agent] org=${orgId} actor=${actorId} agentId=${r.agentId} created=${r.created}`);
    }
    const alreadyExisted = candidates.length - created;
    if (candidates.length > 0) {
      console.log(`[backfill-team3-agent] done: ${created} created, ${alreadyExisted} already existed`);
    } else {
      console.log("[backfill-team3-agent] nothing to create -- no Workspace-named org missing team3, or none found");
    }
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted };
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await backfillTeam3Agent();
}
