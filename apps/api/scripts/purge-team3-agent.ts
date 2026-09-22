/**
 * Team3「前沿赛道技术路线研判」的**数据清除**脚本。
 *
 * 2026-09-22 人类指令：team3 下线，库里那条 agent 记录要删干净——它的 instructions
 * 是私有的 agent 技术，不留残骸。
 *
 * ## 为什么需要这个脚本
 *
 * `chore(team3): 下线…` 那个提交删掉了补种脚本与整层实现，但**删代码不删数据**：
 * 已经跑过部署的环境里，`agents` / `agent_versions` / `capability_listings` 三张表
 * 仍然各留着一行，其中 `agent_versions.instructions` 就是那份完整的分析守则原文。
 * 不跑这一步，"下线"只是前端看不见了。
 *
 * ## 清除范围：按 agent_id 横扫，而不是手写一张表清单
 *
 * `ensureSystemAgent` 只写三张表，但这条 agent 一旦被用过，痕迹会散进运行链路
 * （`agent_runs` 及其 steps/deltas/snapshots、`chat_thread_agents` 的入编行……）。
 * 手写清单的问题是**写的那天是对的，后来加了表就漏**——而漏掉的恰恰是最要命的那种：
 * 上下文快照里存着完整 system prompt。
 *
 * 所以这里问 `information_schema`：凡是有 `agent_id` 列的表，统统按 id 删。
 * 表是当场发现的，将来新增的表自动进入清除范围，不依赖谁记得回来改这个文件。
 * 删除顺序交给 Postgres：整个清除跑在一个事务里，并在事务开头
 * `SET CONSTRAINTS ALL DEFERRED`，可延迟的外键就不必人工排序；不可延迟的外键若仍
 * 报错，会带着表名抛出来——那是需要人看一眼的真实依赖，不该被脚本猜着绕过去。
 *
 * ## 默认不删：用户的对话内容
 *
 * 用 team3 聊过的那些 chat 线程与消息是**用户自己的数据**，不是 agent 技术。
 * 默认只摘掉「这条线程编制里有 team3」的入编行，线程与消息原样保留。
 * 确实要连对话一起清的话加 `--purge-threads`——那会删掉那些线程及其消息，不可逆。
 *
 * ## 用法
 *
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts              # 只报告，不动数据
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts --apply      # 真的删
 *   pnpm --filter api exec tsx scripts/purge-team3-agent.ts --apply --purge-threads
 *
 * 默认是 dry-run：先让人看清楚要删哪些行、共几行，再决定。幂等——跑第二次会报告
 * 「没有找到 team3 的 agent 行」并正常退出 0。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";

/** 与已删除的 `backfill-team3-agent.ts` 用的是同一个字面量——靠它定位，不靠显示名。 */
export const TEAM3_AGENT_STABLE_NAME = "team3-frontier-track-research";
/** `capability_listings` 没有 stable_name 列，只能按展示名删。 */
export const TEAM3_AGENT_DISPLAY_NAME = "前沿赛道技术路线研判";

export interface PurgeReport {
  /** 命中的 agents 行数（跨组织；正常是 0 或 1）。 */
  readonly agentCount: number;
  /** 表名 → 该表命中的行数。只列出命中 > 0 的表。 */
  readonly rowsByTable: Readonly<Record<string, number>>;
  /** 命中的 capability_listings 行数。 */
  readonly listingCount: number;
  /** 连带删除的 chat 线程数；未开 --purge-threads 时恒为 0。 */
  readonly threadCount: number;
  /** false = dry-run，一行都没删。 */
  readonly applied: boolean;
}

/**
 * 发现所有带 `agent_id` 列的表。
 *
 * 限定 `table_schema = 'public'` 且是 BASE TABLE：视图不存数据，删视图会报错；
 * 其他 schema（如 pg_catalog）与本仓无关。
 */
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
  // 用 migration 角色而不是 app_rw：RLS 对 app_rw 是 FORCE 的，按 org 过滤，
  // 而这里要跨全部组织清干净。owner 角色绕过 RLS 是这一步**需要**的能力。
  const pool = new pg.Pool({ ...migrationConfig(), max: 2 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    const { rows: agentRows } = await client.query<{ id: string; org_id: string }>(
      "SELECT id, org_id FROM agents WHERE stable_name = $1",
      [TEAM3_AGENT_STABLE_NAME],
    );
    const agentIds = agentRows.map((r) => r.id);

    if (agentIds.length === 0) {
      await client.query("ROLLBACK");
      console.log("[purge-team3-agent] 库里没有 team3 的 agent 行——无需清除（幂等，第二次跑就是这个结果）");
      return { agentCount: 0, rowsByTable: {}, listingCount: 0, threadCount: 0, applied: opts.apply };
    }
    for (const r of agentRows) console.log(`[purge-team3-agent] 命中 agent id=${r.id} org=${r.org_id}`);

    // 先数，再删：dry-run 下人看到的数字，与 --apply 会删掉的行是同一次统计。
    const tables = await tablesWithAgentId(client);
    const rowsByTable: Record<string, number> = {};
    for (const table of tables) {
      const { rows } = await client.query<{ n: string }>(
        // 表名来自 information_schema，不是外部输入；仍用 format 的标识符引用，
        // 避免大小写/保留字表名拼出坏 SQL。
        `SELECT count(*)::text AS n FROM ${JSON.stringify(table)} WHERE agent_id = ANY($1::text[])`,
        [agentIds],
      );
      const n = Number(rows[0]?.n ?? "0");
      if (n > 0) rowsByTable[table] = n;
    }

    // `agents` 自己按主键命中，不走 agent_id 那一轮。
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

    console.log(`[purge-team3-agent] 带 agent_id 的表共 ${tables.length} 张，其中命中的：`);
    for (const [t, n] of Object.entries(rowsByTable)) console.log(`  ${t}: ${n} 行`);
    console.log(`  capability_listings: ${listingCount} 行`);
    console.log(`  agents: ${agentIds.length} 行`);
    console.log(
      `[purge-team3-agent] 入编过 team3 的 chat 线程 ${threadIds.length} 条` +
        (opts.purgeThreads ? "——将连同消息一并删除（--purge-threads）" : "——保留（只摘入编行）"),
    );

    if (!opts.apply) {
      await client.query("ROLLBACK");
      console.log("[purge-team3-agent] dry-run：一行都没删。确认无误后加 --apply 重跑。");
      return { agentCount: agentIds.length, rowsByTable, listingCount, threadCount: 0, applied: false };
    }

    for (const table of Object.keys(rowsByTable)) {
      await client.query(`DELETE FROM ${JSON.stringify(table)} WHERE agent_id = ANY($1::text[])`, [agentIds]);
    }
    await client.query("DELETE FROM capability_listings WHERE kind = 'agent' AND name = $1", [
      TEAM3_AGENT_DISPLAY_NAME,
    ]);
    await client.query("DELETE FROM agents WHERE id = ANY($1::text[])", [agentIds]);

    let threadCount = 0;
    if (opts.purgeThreads && threadIds.length > 0) {
      // 线程的下游（消息、附件、可见性行）都挂着 ON DELETE CASCADE，删线程即连带清掉。
      const { rowCount } = await client.query("DELETE FROM chat_threads WHERE id = ANY($1::text[])", [threadIds]);
      threadCount = rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(
      `[purge-team3-agent] 已清除：agents ${agentIds.length} 行、capability_listings ${listingCount} 行、` +
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const apply = process.argv.includes("--apply");
  const purgeThreads = process.argv.includes("--purge-threads");
  if (purgeThreads && !apply) {
    console.log("[purge-team3-agent] 注意：--purge-threads 只在 --apply 时生效，本次仍是 dry-run。");
  }
  await purgeTeam3Agent({ apply, purgeThreads });
}
