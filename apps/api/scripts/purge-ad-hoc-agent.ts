/**
 * 一个 ad-hoc Agent 的**数据清除**脚本。
 *
 * 下线一个 ad-hoc Agent 时，删代码**不删数据**：已经跑过部署的环境里，
 * `agents` / `agent_versions` / `capability_listings` 三张表仍然各留着一行，
 * 其中 `agent_versions.instructions` 就是那份完整的 instructions 原文。不跑这一步，
 * 「下线」只是前端看不见了。
 *
 * ## 目标 Agent 由调用方在命令行给出，不写死在仓库里
 *
 * 这个脚本刻意**不带**任何具体 Agent 的名字：那些名字本身就是要清除的东西之一
 * （2026-09-24 人类指令：开源仓库里不留私有 agent 技术的任何内容）。谁要清，谁在
 * 那台机器上把名字传进来——脚本是通用能力，名字是一次性的运维输入。
 *
 * ## 清除范围：按 agent_id 横扫，而不是手写一张表清单
 *
 * `ensureSystemAgent` 只写三张表，但一条 agent 一旦被用过，痕迹会散进运行链路
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
 * 跟这个 Agent 聊过的 chat 线程与消息是**用户自己的数据**，不是 agent 技术。
 * 默认只摘掉「这条线程编制里有它」的入编行，线程与消息原样保留。
 * 确实要连对话一起清的话加 `--purge-threads`——那会删掉那些线程及其消息，不可逆。
 *
 * ## 用法
 *
 *   pnpm --filter api exec tsx scripts/purge-ad-hoc-agent.ts \\
 *     --stable-name=<agents.stable_name> [--display-name=<capability_listings.name>]
 *
 * 加 `--apply` 才真的删，默认 dry-run：先让人看清楚要删哪些行、共几行，再决定。
 * `--display-name` 可省——`capability_listings` 没有 stable_name 列，只能按展示名删，
 * 不给就跳过那张表（并在报告里说明），不去猜。
 * 幂等——跑第二次会报告「没有找到匹配的 agent 行」并正常退出 0。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { isCliEntry } from "./cli-entry";

const LOG = "[purge-ad-hoc-agent]";

export interface PurgeTarget {
  /** `agents.stable_name`——定位靠它，不靠显示名。 */
  readonly stableName: string;
  /** `capability_listings.name`。该表没有 stable_name 列，只能按展示名删；省略则跳过该表。 */
  readonly displayName?: string;
}

export interface PurgeReport {
  /** 命中的 agents 行数（跨组织；正常是 0 或 1）。 */
  readonly agentCount: number;
  /** 表名 → 该表命中的行数。只列出命中 > 0 的表。 */
  readonly rowsByTable: Readonly<Record<string, number>>;
  /** 命中的 capability_listings 行数；未给 displayName 时恒为 0。 */
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

export async function purgeAdHocAgent(
  target: PurgeTarget,
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
      [target.stableName],
    );
    const agentIds = agentRows.map((r) => r.id);

    if (agentIds.length === 0) {
      await client.query("ROLLBACK");
      console.log(`${LOG} 库里没有 stable_name=${target.stableName} 的 agent 行——无需清除（幂等，第二次跑就是这个结果）`);
      return { agentCount: 0, rowsByTable: {}, listingCount: 0, threadCount: 0, applied: opts.apply };
    }
    for (const r of agentRows) console.log(`${LOG} 命中 agent id=${r.id} org=${r.org_id}`);

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
    // 没给展示名就不动 capability_listings：按 stable_name 查不到它，猜一个名字去
    // DELETE 可能删掉别人的挂牌行——宁可报告「跳过」，让人补上参数重跑。
    let listingCount = 0;
    if (target.displayName !== undefined) {
      const { rows: listingRows } = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM capability_listings WHERE kind = 'agent' AND name = $1",
        [target.displayName],
      );
      listingCount = Number(listingRows[0]?.n ?? "0");
    }

    const { rows: threadRows } = await client.query<{ id: string }>(
      "SELECT DISTINCT thread_id AS id FROM chat_thread_agents WHERE agent_id = ANY($1::text[])",
      [agentIds],
    );
    const threadIds = threadRows.map((r) => r.id);

    console.log(`${LOG} 带 agent_id 的表共 ${tables.length} 张，其中命中的：`);
    for (const [t, n] of Object.entries(rowsByTable)) console.log(`  ${t}: ${n} 行`);
    console.log(
      "  capability_listings: " +
        (target.displayName === undefined ? "跳过（未给 --display-name）" : `${listingCount} 行`),
    );
    console.log(`  agents: ${agentIds.length} 行`);
    console.log(
      `${LOG} 入编过它的 chat 线程 ${threadIds.length} 条` +
        (opts.purgeThreads ? "——将连同消息一并删除（--purge-threads）" : "——保留（只摘入编行）"),
    );

    if (!opts.apply) {
      await client.query("ROLLBACK");
      console.log(`${LOG} dry-run：一行都没删。确认无误后加 --apply 重跑。`);
      return { agentCount: agentIds.length, rowsByTable, listingCount, threadCount: 0, applied: false };
    }

    for (const table of Object.keys(rowsByTable)) {
      await client.query(`DELETE FROM ${JSON.stringify(table)} WHERE agent_id = ANY($1::text[])`, [agentIds]);
    }
    if (target.displayName !== undefined) {
      await client.query("DELETE FROM capability_listings WHERE kind = 'agent' AND name = $1", [
        target.displayName,
      ]);
    }
    await client.query("DELETE FROM agents WHERE id = ANY($1::text[])", [agentIds]);

    let threadCount = 0;
    if (opts.purgeThreads && threadIds.length > 0) {
      // 线程的下游（消息、附件、可见性行）都挂着 ON DELETE CASCADE，删线程即连带清掉。
      const { rowCount } = await client.query("DELETE FROM chat_threads WHERE id = ANY($1::text[])", [threadIds]);
      threadCount = rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(
      `${LOG} 已清除：agents ${agentIds.length} 行、capability_listings ${listingCount} 行、` +
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

/** `--key=value` 取值；没给返回 undefined。 */
export function readFlag(argv: readonly string[], key: string): string | undefined {
  const prefix = `--${key}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

if (isCliEntry(import.meta.url)) {
  const stableName = readFlag(process.argv, "stable-name");
  if (stableName === undefined || stableName === "") {
    console.error(`${LOG} 必须给 --stable-name=<agents.stable_name>（本脚本刻意不写死任何 Agent 的名字）`);
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const purgeThreads = process.argv.includes("--purge-threads");
  if (purgeThreads && !apply) {
    console.log(`${LOG} 注意：--purge-threads 只在 --apply 时生效，本次仍是 dry-run。`);
  }
  await purgeAdHocAgent({ stableName, displayName: readFlag(process.argv, "display-name") }, { apply, purgeThreads });
}
