/**
 * Team2 ad-hoc MVP agent 补种脚本 —— 「投后财务项目评级 Agent」
 * （`docs/agents/team2-postinvest-rating-mvp.md`）。
 *
 * ## 为什么新增这一条，而不是继续让人去跑 `publish-team2-agent.ts`
 *
 * `publish-team2-agent.ts` 要人拿着 admin 账号密码、在某个真实部署环境手工跑一次，
 * 再把打印出来的 agentId 回填进前端（或配一个 NEXT_PUBLIC_ 环境变量重新构建）。
 * 那是两次人工动作、一份跨环境不通用的 id、一个"忘了跑就静默禁用"的失败模式。
 * 正确形状是：部署期幂等补种 + 前端按名字在组织能力目录里查真实 id。本脚本走这条路
 * ——部署即生效，无人工步骤，无需回填任何 id。`publish-team2-agent.ts` 保留为
 * "本机开发库手工验证"的逃生口。
 *
 * ## 为什么是脚本，不是迁移；为什么不 hook 进注册控制器
 *
 * `capability_listings` 禁止迁移 INSERT，种子只能走 `ensureSystemAgent` 这条应用层
 * 写路径；team2 是临时 Agent，删除时从 `deploy.sh` 摘掉这一步即可，不动共享控制器
 * ——把补种做成「一个脚本 + 部署期一次调用」而不是焊进共享的注册控制器，为的正是
 * 这一刻能一步摘干净。
 *
 * ## 目标组织与 model provider
 *
 * 只种到显示名为「Workspace」的组织（与 `isAgentsNavVisibleForOrg` 判定
 * `/agent` 导航可见性用的是同一个组织标识）；provider 复用 `resolveDeepAgentModel()`。
 *
 * ## instructions 的单一事实源
 *
 * 直接复用 `apps/web/lib/postinvest-rating/rating-prompt.ts` 的 `buildRatingPrompt([])`
 * ——落地页发起对话时投进去的任务书与 Agent 自身的 instructions 是同一份规则，
 * 不在这里另抄一份（`publish-team2-agent.ts` 也是这么导入的）。
 */
import { isCliEntry } from "./cli-entry";
import pg from "pg";
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { ensureSystemAgent, type SystemAgentTemplate } from "../src/infrastructure/agent/pg-system-agent-repository";
import { resolveDeepAgentModel } from "../src/infrastructure/agent/pg-default-agent-repository";
import { RATING_AGENT } from "../../web/lib/postinvest-rating/agent-directory";
import { buildRatingPrompt } from "../../web/lib/postinvest-rating/rating-prompt";

export const TEAM2_AGENT_STABLE_NAME = "team2-postinvest-rating";

export const TEAM2_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: TEAM2_AGENT_STABLE_NAME,
  // 展示名与前端查找用的名字必须是同一个字面量，否则前端按名字查不到——
  // 因此直接读 `RATING_AGENT.name`（落地页文案的单一事实源），不在这里重新声明。
  name: RATING_AGENT.name,
  abbr: "PI",
  duty: "读取财务报表/审计报告/访谈录音，按固定规则沙箱算分，产出带依据与不确定性标注的 A–E 投后评级",
  roleLabel: "投后评级",
  instructions: buildRatingPrompt([]),
  // 0x7ea3 已被 team3 占用；换一个不冲突的常量。
  lockKey: 0x7ea4,
  resolveModel: resolveDeepAgentModel,
};

export interface Team2BackfillReport {
  readonly candidateCount: number;
  readonly skippedNoAdmin: number;
  readonly created: number;
  readonly alreadyExisted: number;
}

export async function backfillTeam2Agent(): Promise<Team2BackfillReport> {
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
      [TEAM2_AGENT_STABLE_NAME],
    );
    candidates = rows
      .filter((r): r is { org_id: string; actor_id: string } => r.actor_id !== null)
      .map((r) => ({ orgId: r.org_id, actorId: r.actor_id }));
    skippedNoAdmin = rows.length - candidates.length;
    if (skippedNoAdmin > 0) {
      console.log(`[backfill-team2-agent] skipping ${skippedNoAdmin} org(s) named Workspace with no admin member yet`);
    }
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    let created = 0;
    for (const { orgId, actorId } of candidates) {
      const r = await ensureSystemAgent(db, TEAM2_AGENT_TEMPLATE, { orgId, actorId, now: new Date() });
      if (r.created) created += 1;
      console.log(`[backfill-team2-agent] org=${orgId} actor=${actorId} agentId=${r.agentId} created=${r.created}`);
    }
    const alreadyExisted = candidates.length - created;
    if (candidates.length > 0) {
      console.log(`[backfill-team2-agent] done: ${created} created, ${alreadyExisted} already existed`);
    } else {
      console.log("[backfill-team2-agent] nothing to create -- no Workspace-named org missing team2, or none found");
    }
    return { candidateCount: candidates.length, skippedNoAdmin, created, alreadyExisted };
  } finally {
    await db.close();
  }
}

if (isCliEntry(import.meta.url)) {
  await backfillTeam2Agent();
}
