/**
 * team3「前沿赛道技术路线研判」的**数据清除**脚本（2026-09-25 人类指令：连同「海创汇」
 * 整个 nav 入口一起下线）。做法与 `purge-ic-review-agent.ts` / `purge-postinvest-agents.ts`
 * 同构（同一套理由，这里不重复长论证，只说差异）。
 *
 * ## 定位方式（差异点）
 *
 * - team3 由已删除的 `backfill-team3-agent.ts` 通过 `ensureSystemAgent` 种下，
 *   该文件已被 #3858 删除、`stable_name` 字面量没有留存在仓库任何地方——只能按
 *   `agents.name` 这个展示名定位（同 team1/team4 的先例）。
 * - #3858 已经用迁移 `20260922010000_drop_research_workflow_sessions.sql` 删掉了
 *   `research_predictions` / `research_gate_audit` / `research_materials` /
 *   `research_sessions` 四张业务表，但**没有**删 `agents` / `capability_listings`
 *   这两行——这正是本脚本要补的最后一步。
 * - team3 没有平台内置 Skill（不像 team1/team4 各自挂了一个），只清 agent 本身。
 *
 * ## 默认不删：用户的对话内容
 *
 * 同 `purge-ic-review-agent.ts`：默认只摘入编行与挂载行，线程与消息保留；
 * `--purge-threads` 才连同入编过这个 agent 的线程一起删（不可逆）。
 *
 * ## 用法
 *
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts              # 只报告
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts --apply      # 真的删
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts --apply --purge-threads
 *
 * 幂等：第二次跑报告「没有命中」并退出 0。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { isCliEntry } from "./cli-entry";

/** 已删除的 `backfill-team3-agent.ts` 建的 agent 的展示名（唯一留存的定位依据）。 */
export const TEAM3_AGENT_DISPLAY_NAME = "前沿赛道技术路线研判";

const TAG = "[purge-team3-agent]";

export interface PurgeReport {
  readonly agentCount: number;
  /** 表名 → 命中行数（agent_id 横扫）。只列 > 0 的表。 */
  readonly rowsByTable: Readonly<Record<string, number>>;
  readonly listingCount: number;
  readonly threadCount: number;
  readonly applied: boolean;
}

async function tablesWithAgentId(client: pg.ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'agent_id'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return rows.map((r) => r.table_name);
}

export async function purgeTeam3Agent(
  opts: { apply: boolean; purgeThreads: boolean } = { apply: false, purgeThreads: false },
): Promise<PurgeReport> {
  // migration 角色绕过 RLS，跨全部组织清（同 purge-ad-hoc-agent.ts）。
  const pool = new pg.Pool({ ...migrationConfig(), max: 2 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    const { rows: agentRows } = await client.query<{ id: string; org_id: string; name: string }>(
      "SELECT id, org_id, name FROM agents WHERE name = $1",
      [TEAM3_AGENT_DISPLAY_NAME],
    );
    const agentIds = agentRows.map((r) => r.id);

    if (agentIds.length === 0) {
      await client.query("ROLLBACK");
      console.log(`${TAG} 库里没有 name=${TEAM3_AGENT_DISPLAY_NAME} 的 agent 行——无需清除（幂等）`);
      return { agentCount: 0, rowsByTable: {}, listingCount: 0, threadCount: 0, applied: opts.apply };
    }
    for (const r of agentRows) console.log(`${TAG} 命中 agent id=${r.id} org=${r.org_id} name=${r.name}`);

    // 先数，再删：dry-run 的数字与 --apply 删掉的行是同一次统计。
    const rowsByTable: Record<string, number> = {};
    const tables = await tablesWithAgentId(client);
    for (const table of tables) {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${JSON.stringify(table)} WHERE agent_id = ANY($1::text[])`,
        [agentIds],
      );
      const n = Number(rows[0]?.n ?? "0");
      if (n > 0) rowsByTable[table] = n;
    }

    const { rows: listingRows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM capability_listings WHERE kind = 'agent' AND name = $1",
      [TEAM3_AGENT_DISPLAY_NAME],
    );
    const listingCount = Number(listingRows[0]?.n ?? "0");

    const { rows: threadRows } = await client.query<{ id: string }>(
      "SELECT DISTINCT thread_id AS id FROM chat_thread_agents WHERE agent_id = ANY($1::text[])",
      [agentIds],
    );
    const threadIds = threadRows.map((r) => r.id);

    console.log(`${TAG} 命中的关联表：`);
    for (const [t, n] of Object.entries(rowsByTable)) console.log(`  ${t}: ${n} 行`);
    console.log(`  capability_listings: ${listingCount} 行`);
    console.log(`  agents: ${agentIds.length} 行`);
    console.log(
      `${TAG} 入编过这个 agent 的 chat 线程 ${threadIds.length} 条` +
        (opts.purgeThreads ? "——将连同消息一并删除（--purge-threads）" : "——保留（只摘入编行）"),
    );

    if (!opts.apply) {
      await client.query("ROLLBACK");
      console.log(`${TAG} dry-run：一行都没删。确认无误后加 --apply 重跑。`);
      return { agentCount: agentIds.length, rowsByTable, listingCount, threadCount: 0, applied: false };
    }

    for (const [table, n] of Object.entries(rowsByTable)) {
      void n;
      await client.query(
        `DELETE FROM ${JSON.stringify(table)} WHERE agent_id = ANY($1::text[])`,
        [agentIds],
      );
    }
    await client.query("DELETE FROM capability_listings WHERE kind = 'agent' AND name = $1", [TEAM3_AGENT_DISPLAY_NAME]);
    await client.query("DELETE FROM agents WHERE id = ANY($1::text[])", [agentIds]);

    let threadCount = 0;
    if (opts.purgeThreads && threadIds.length > 0) {
      // 线程下游（消息、附件、可见性行）都挂着 ON DELETE CASCADE。
      const { rowCount } = await client.query("DELETE FROM chat_threads WHERE id = ANY($1::text[])", [threadIds]);
      threadCount = rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(
      `${TAG} 已清除：agents ${agentIds.length} 行、capability_listings ${listingCount} 行、` +
        `其余关联表 ${Object.values(rowsByTable).reduce((a, b) => a + b, 0)} 行` +
        (threadCount > 0 ? `、chat 线程 ${threadCount} 条` : ""),
    );
    return { agentCount: agentIds.length, rowsByTable, listingCount, threadCount, applied: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (isCliEntry(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  const purgeThreads = process.argv.includes("--purge-threads");
  if (purgeThreads && !apply) {
    console.log(`${TAG} 注意：--purge-threads 只在 --apply 时生效，本次仍是 dry-run。`);
  }
  await purgeTeam3Agent({ apply, purgeThreads });
}
