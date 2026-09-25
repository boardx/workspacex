/**
 * team1「上会材料智能审阅助手」的**数据清除**脚本（2026-09-25 人类指令：连同「海创汇」
 * 整个 nav 入口一起下线）。做法与 `purge-postinvest-agents.ts` 同构（同一套理由，这里
 * 不重复长论证，只说差异）。
 *
 * ## 定位方式（差异点）
 *
 * - team1 只走过前端 `ensure-agent.ts` 的按需自动发布（点「开始审阅」时才建），
 *   **没有**固定 stable_name——同 team4 的先例，按展示名定位。
 * - 平台内置 Skill 由已删除的 `ensureIcReviewSkillSeeded()`（原住在
 *   `ensure-platform-skill-catalog.ts` 末尾）在 `main.ts` 启动时自愈种下：
 *   `skills` / `skill_versions` / `skill_version_files` / `capability_listings` 各一行
 *   （id 固定为 `skill-team1-ic-review-standard`，stable_name `ic-review-standard`）。
 *
 * ## 默认不删：用户的对话内容
 *
 * 同 `purge-postinvest-agents.ts`：默认只摘入编行与挂载行，线程与消息保留；
 * `--purge-threads` 才连同入编过这个 agent 的线程一起删（不可逆）。
 *
 * ## 用法
 *
 *   pnpm --filter api exec tsx scripts/purge-ic-review-agent.ts              # 只报告
 *   pnpm --filter api exec tsx scripts/purge-ic-review-agent.ts --apply      # 真的删
 *   pnpm --filter api exec tsx scripts/purge-ic-review-agent.ts --apply --purge-threads
 *
 * 幂等：第二次跑报告「没有命中」并退出 0。
 */
import pg from "pg";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { isCliEntry } from "./cli-entry";

/** 已删除的 `apps/web/lib/ic-review/agent-directory.ts` 的 `AGENT_DIRECTORY[0].name`。 */
export const IC_REVIEW_AGENT_DISPLAY_NAME = "上会材料智能审阅助手";
/** 已删除的 `apps/web/lib/ic-review/skill-identity.ts` 的 `IC_REVIEW_SKILL_ID`。 */
export const IC_REVIEW_SKILL_ID = "skill-team1-ic-review-standard";
/** 已删除的 `ensure-platform-skill-catalog.ts` 里的 stable_name / 展示名。 */
export const IC_REVIEW_SKILL_STABLE_NAME = "ic-review-standard";
export const IC_REVIEW_SKILL_DISPLAY_NAME = "上会审阅";

const TAG = "[purge-ic-review-agent]";

export interface PurgeReport {
  readonly agentCount: number;
  readonly skillCount: number;
  /** 表名 → 命中行数（agent_id / skill_id 横扫 + 显式清的表）。只列 > 0 的表。 */
  readonly rowsByTable: Readonly<Record<string, number>>;
  readonly listingCount: number;
  readonly threadCount: number;
  readonly applied: boolean;
}

async function tablesWithColumn(client: pg.ClientBase, column: string): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
    [column],
  );
  return rows.map((r) => r.table_name);
}

async function countWhere(client: pg.ClientBase, table: string, column: string, ids: string[]): Promise<number> {
  // 表名/列名来自 information_schema 或本文件常量，不是外部输入。
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${JSON.stringify(table)} WHERE ${JSON.stringify(column)} = ANY($1::text[])`,
    [ids],
  );
  return Number(rows[0]?.n ?? "0");
}

export async function purgeIcReviewAgent(
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
      [IC_REVIEW_AGENT_DISPLAY_NAME],
    );
    const agentIds = agentRows.map((r) => r.id);
    const { rows: skillRows } = await client.query<{ id: string; org_id: string }>(
      "SELECT id, org_id FROM skills WHERE id = $1 OR stable_name = $2",
      [IC_REVIEW_SKILL_ID, IC_REVIEW_SKILL_STABLE_NAME],
    );
    const skillIds = skillRows.map((r) => r.id);

    if (agentIds.length === 0 && skillIds.length === 0) {
      await client.query("ROLLBACK");
      console.log(`${TAG} 库里没有 team1 agent 或其内置 Skill 的行——无需清除（幂等）`);
      return { agentCount: 0, skillCount: 0, rowsByTable: {}, listingCount: 0, threadCount: 0, applied: opts.apply };
    }
    for (const r of agentRows) console.log(`${TAG} 命中 agent id=${r.id} org=${r.org_id} name=${r.name}`);
    for (const r of skillRows) console.log(`${TAG} 命中 skill id=${r.id} org=${r.org_id}`);

    // 先数，再删：dry-run 的数字与 --apply 删掉的行是同一次统计。
    const rowsByTable: Record<string, number> = {};
    const sweeps: Array<{ table: string; column: string; ids: string[] }> = [];
    if (agentIds.length > 0) {
      for (const table of await tablesWithColumn(client, "agent_id")) sweeps.push({ table, column: "agent_id", ids: agentIds });
    }
    if (skillIds.length > 0) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM skill_versions WHERE skill_id = ANY($1::text[])",
        [skillIds],
      );
      const skillVersionIds = rows.map((r) => r.id);
      // 版本文件挂在 version_id 上（该列名在别的表里指 artifact 版本，所以不横扫，只点名这一张）。
      if (skillVersionIds.length > 0) sweeps.push({ table: "skill_version_files", column: "version_id", ids: skillVersionIds });
      for (const table of await tablesWithColumn(client, "skill_version_id")) {
        sweeps.push({ table, column: "skill_version_id", ids: skillVersionIds });
      }
      // skill_versions 放最后：挂载行等引用它，不可延迟的外键下先删引用方。
      const skillTables = (await tablesWithColumn(client, "skill_id"))
        .sort((x, y) => Number(x === "skill_versions") - Number(y === "skill_versions"));
      for (const table of skillTables) sweeps.push({ table, column: "skill_id", ids: skillIds });
    }
    const hits: typeof sweeps = [];
    for (const s of sweeps) {
      if (s.ids.length === 0) continue;
      const n = await countWhere(client, s.table, s.column, s.ids);
      if (n > 0) {
        hits.push(s);
        rowsByTable[`${s.table}.${s.column}`] = n;
      }
    }

    const listingSql =
      "(kind = 'agent' AND name = $1) OR (kind = 'skill' AND (id = ANY($2::text[]) OR name = $3))";
    const listingArgs = [IC_REVIEW_AGENT_DISPLAY_NAME, skillIds.length > 0 ? skillIds : [IC_REVIEW_SKILL_ID], IC_REVIEW_SKILL_DISPLAY_NAME];
    const { rows: listingRows } = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM capability_listings WHERE ${listingSql}`,
      listingArgs,
    );
    const listingCount = Number(listingRows[0]?.n ?? "0");

    const { rows: threadRows } = agentIds.length > 0
      ? await client.query<{ id: string }>(
          "SELECT DISTINCT thread_id AS id FROM chat_thread_agents WHERE agent_id = ANY($1::text[])",
          [agentIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const threadIds = threadRows.map((r) => r.id);

    console.log(`${TAG} 命中的关联表：`);
    for (const [t, n] of Object.entries(rowsByTable)) console.log(`  ${t}: ${n} 行`);
    console.log(`  capability_listings: ${listingCount} 行`);
    console.log(`  agents: ${agentIds.length} 行`);
    console.log(`  skills: ${skillIds.length} 行`);
    console.log(
      `${TAG} 入编过这个 agent 的 chat 线程 ${threadIds.length} 条` +
        (opts.purgeThreads ? "——将连同消息一并删除（--purge-threads）" : "——保留（只摘入编行）"),
    );

    if (!opts.apply) {
      await client.query("ROLLBACK");
      console.log(`${TAG} dry-run：一行都没删。确认无误后加 --apply 重跑。`);
      return { agentCount: agentIds.length, skillCount: skillIds.length, rowsByTable, listingCount, threadCount: 0, applied: false };
    }

    for (const s of hits) {
      await client.query(
        `DELETE FROM ${JSON.stringify(s.table)} WHERE ${JSON.stringify(s.column)} = ANY($1::text[])`,
        [s.ids],
      );
    }
    await client.query(`DELETE FROM capability_listings WHERE ${listingSql}`, listingArgs);
    if (agentIds.length > 0) await client.query("DELETE FROM agents WHERE id = ANY($1::text[])", [agentIds]);
    if (skillIds.length > 0) await client.query("DELETE FROM skills WHERE id = ANY($1::text[])", [skillIds]);

    let threadCount = 0;
    if (opts.purgeThreads && threadIds.length > 0) {
      // 线程下游（消息、附件、可见性行）都挂着 ON DELETE CASCADE。
      const { rowCount } = await client.query("DELETE FROM chat_threads WHERE id = ANY($1::text[])", [threadIds]);
      threadCount = rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log(
      `${TAG} 已清除：agents ${agentIds.length} 行、skills ${skillIds.length} 行、capability_listings ${listingCount} 行、` +
        `其余关联表 ${Object.values(rowsByTable).reduce((a, b) => a + b, 0)} 行` +
        (threadCount > 0 ? `、chat 线程 ${threadCount} 条` : ""),
    );
    return { agentCount: agentIds.length, skillCount: skillIds.length, rowsByTable, listingCount, threadCount, applied: true };
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
  await purgeIcReviewAgent({ apply, purgeThreads });
}
