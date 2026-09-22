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
import { isCliEntry } from "./cli-entry";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import {
  ensureSystemAgent,
  republishSystemAgentVersion,
  type SystemAgentTemplate,
} from "../src/infrastructure/agent/pg-system-agent-repository";
import { resolveDeepAgentModel } from "../src/infrastructure/agent/pg-default-agent-repository";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const TEAM3_AGENT_STABLE_NAME = "team3-frontier-track-research";
export const TEAM3_AGENT_NAME = "前沿赛道技术路线研判";
/**
 * 2026-09-15 人类追加要求：支持上传 PDF / 给 URL，并用它们产出「分析和推理相关」的
 * 产业图谱（不是照抄材料的静态框图）。**不新造任何管道**——`wx_document_parse`
 * （PDF/Word/扫描件解析）、`fetch_url`/`web_search`（URL 材料）、`wx_canvas_update`
 * （fabric.js 渲染，`chat-diagram-fabric.tsx` 同一条管线）三者已经在
 * `native-invocation.ts` 的 `NATIVE_PROFILE_TOOLS` 固定表里，对平台每个 agent 一视同仁
 * 开放，不按 `tool_policy` 过滤（见本文件下方「toolWhitelist」一节的既有说明）。
 * 这次只是在 instructions 里把「可以用」讲清楚，不补一行工具准入代码。
 */
export const TEAM3_AGENT_INSTRUCTIONS =
  "你是本组织的「前沿赛道技术路线研判」分析助手（系统预置，MVP 版本）。\n\n" +
  "你的工作是帮助用户整理与研判前沿技术赛道（如量子计算、新能源材料等）的产业动态。" +
  "用户可以用三种方式给你材料：直接粘贴文字、上传文件（PDF、Word、图片等，你可以用" +
  "文档解析工具读取其内容）、给一个网页链接（你可以用网页抓取工具读取该链接的内容）。" +
  "拿到专家访谈转录稿、产业链研究纪要、政策汇编等原始材料后，你要把它们转成可供投资" +
  "研究使用的结构化分析。请始终遵守以下分析纪律：\n\n" +
  "1. 里程碑提取：从材料中提取带时间节点的技术/产业里程碑，标注它在原文中的大致位置" +
  "（如「访谈第 X 段」「纪要第 X 部分」「链接第 X 段」），不要遗漏也不要编造日期。\n" +
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
  "500 字的判断与建议摘要，供投研人员快速阅读。\n" +
  "6. 分析产业链材料（不论是粘贴的文字、上传的文件、还是链接抓取的内容）时，优先" +
  "把产业链画成节点图。**画法：在回复里直接写一个 ```mermaid 围栏代码块**（用 " +
  "flowchart，按上游/中游/下游/应用分层，建议用 subgraph 分区）——聊天界面会把它渲染成" +
  "可交互的图，用户可以点开放大、还能把它保存下来。不要去调画布类工具：那类工具面向的是" +
  "线下工作坊议程环节里的画布实例，你所在的对话没有那种上下文，调了会失败。\n" +
  "   这张图要体现你的分析和推理，不是照抄材料的静态框图：每个节点的标签里写清名称与" +
  "你的判断状态（如「低温制冷设备｜优先研究」「量子 EDA｜严重缺失」），状态由你基于材料" +
  "的判断给出而不是随意打标；节点之间的连线要体现你识别出的供应/应用关系，连线上可以" +
  "标注关系词。图之后仍然要在文字里说明每个节点状态背后的依据（对应第 1-4 条纪律），" +
  "不能只有图没有文字依据。材料过于简单、没有产业链结构可画时，不必勉强画图。\n\n" +
  "\n【流程与三道人工确认门】\n" +
  "这条研判走一条有阶段的流程，界面上方的阶段条会显示当前在哪一步。三道门由**人**来点，" +
  "你点不了，也绕不过去：\n" +
  "① 材料是否符合要求 —— 用户逐条判定每份材料通过/缺失/有误后才会放行；\n" +
  "② 推理链是否成立 —— 用户确认后图谱才会发布成正式版本；\n" +
  "③ 调整方案是否采纳 —— 数月后验证回填完成，用户确认后才更新工作流。\n" +
  "这不是请求，是系统约束：服务端会拒绝任何试图跳过这三道门的推进，并把该次尝试记进" +
  "审计，用户在界面上看得到。所以**不要声称你已经「进入下一步」或「已发布图谱」**——" +
  "那两件事只有用户点了门才会发生。你该做的是：把这一步的产出做好，然后明确告诉用户" +
  "「请在上方确认 XX，确认后我继续」。\n" +
  "材料被退回时，只针对被标为缺失/有误的那几条重新处理，不要整批重做；同一条材料最多" +
  "重来两次，再不行就如实说这条补不上。\n" +
  "图谱发布后请提出几条**可验证的预测**（带时间点与可观测指标，例如「2027 年国产 EDA " +
  "至少覆盖 3 个设计环节」），用户会登记下来，数月后回来逐条比对。预测要具体到能判断" +
  "兑现与否——「前景广阔」这种话没法验证，不要写。\n\n" +
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
  readonly instructionsRepaired: number;
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
    const instructionsRepaired = await repairStaleInstructions(db);
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted, instructionsRepaired };
  } finally {
    await db.close();
  }
}

/**
 * 第二遍：修复已存在但 instructions 落后于当前模板的 team3 agent（同
 * `backfill-default-agents.ts` 的 `repairStaleModelProvider` 一个形状——`agent_versions`
 * 不可变，指令文案变了就发新版本，不 UPDATE 旧行）。这条存在的理由：如果某个环境
 * （如 devapp）已经跑过一次旧版脚本种下了 agent，仅仅改这个文件里的
 * `TEAM3_AGENT_INSTRUCTIONS` 常量、重新部署代码，并不会让那个环境里已经种下的 agent
 * 自动用上新文案——`ensureSystemAgent` 命中"已存在"就直接返回，不会重新发布。
 * 不用手写第二份 INSERT/UPDATE：直接复用 `pg-system-agent-repository.ts` 已经为
 * 这个场景导出的 `republishSystemAgentVersion`。
 */
async function repairStaleInstructions(db: PgDatabase): Promise<number> {
  const instructions = TEAM3_AGENT_INSTRUCTIONS;
  const instructionDigest = sha256(instructions);
  const { provider, modelId } = resolveDeepAgentModel();

  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let stale: { agentId: string; orgId: string; creatorId: string; versionCount: number }[];
  try {
    const { rows } = await owner.query<{ agent_id: string; org_id: string; creator_id: string; version_count: string }>(
      `SELECT av.agent_id, av.org_id, a.creator_id,
              (SELECT count(*) FROM agent_versions v WHERE v.agent_id = av.agent_id) AS version_count
         FROM agent_versions av
         JOIN agents a ON a.id = av.agent_id AND a.published_version_id = av.id
        WHERE a.stable_name = $1 AND av.instruction_digest <> $2`,
      [TEAM3_AGENT_STABLE_NAME, instructionDigest],
    );
    stale = rows.map((r) => ({
      agentId: r.agent_id, orgId: r.org_id, creatorId: r.creator_id, versionCount: Number(r.version_count),
    }));
  } finally {
    await owner.end();
  }

  for (const { agentId, orgId, creatorId, versionCount } of stale) {
    const semanticLabel = `v${versionCount + 1}`;
    await republishSystemAgentVersion(db, { instructions }, {
      orgId, agentId, creatorId, provider, modelId, semanticLabel, now: new Date(),
    });
    console.log(`[backfill-team3-agent] repaired stale instructions: org=${orgId} agent=${agentId} -> ${semanticLabel}`);
  }
  return stale.length;
}

if (isCliEntry(import.meta.url)) {
  await backfillTeam3Agent();
}
