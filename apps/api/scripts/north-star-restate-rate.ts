#!/usr/bin/env node
/**
 * issue #4360（S5）北极星指标采集：**新会话里重复交代已知背景的比例**，外加开场简报（#4362）的展示 / 采纳 / 关闭计数。
 * 口径见 `src/domain/knowledge-graph/north-star.ts`（唯一一份）。
 *
 * 用法（loopback 栈或 devapp 的库都行；以迁移身份只读，不写任何东西）：
 *   PGHOST=… PGPORT=… PGDATABASE=… MIGRATION_DB_PASSWORD=… npx tsx scripts/north-star-restate-rate.ts --org <orgId> [--since <ISO>] [--out <file.json>]
 *
 * 输出一份 JSON：{ org, since, sessions, restated, rate, perSession[], briefing: { shown, accepted, dismissed, acceptRate } }。
 * perSession 只含 id（不含任何对话原文），可以直接贴进证据。
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { knowledgeGraph as KG } from "@repo/contracts";
import { northStar, type BackgroundClaim, type SessionSample } from "../src/domain/knowledge-graph/north-star";
import { migrationConfig } from "../src/infrastructure/db/pg-config";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const org = arg("org");
if (org === null) throw new Error("--org <orgId> is required");
const since = arg("since") ?? "1970-01-01T00:00:00Z";
const out = arg("out");

const client = new pg.Client(migrationConfig());
await client.connect();
try {
  // 新会话：本组织、个人对话、since 之后创建、有本人说的第一条消息。
  const threads = await client.query<{ id: string; user_id: string; created_at: Date; first_message: string }>(
    `SELECT t.id, t.created_by AS user_id, t.created_at,
            (SELECT m.body FROM chat_messages m WHERE m.org_id = t.org_id AND m.thread_id = t.id AND m.author_kind = 'human'
                AND m.author_id = t.created_by ORDER BY m.created_at, m.id LIMIT 1) AS first_message
       FROM chat_threads t
      WHERE t.org_id = $1 AND t.project_id IS NULL AND t.created_at >= $2
      ORDER BY t.created_at, t.id`,
    [org, since],
  );
  const samples: SessionSample[] = [];
  for (const t of threads.rows) {
    if (t.first_message === null) continue;
    // 已知背景：会话开始之前已经记下、当时还活着（没撤销或撤销在之后）的本人长期记忆 + 本人别的个人对话里记下的。
    const bg = await client.query<{ id: string; claim_kind: KG.KgClaimKind | null; statement: string }>(
      `SELECT c.id, c.claim_kind, c.statement FROM claims c
        WHERE c.org_id = $1 AND c.created_at < $3 AND (c.revoked_at IS NULL OR c.revoked_at > $3)
          AND ((c.scope_kind = 'personal' AND c.scope_id = $2)
            OR (c.scope_kind = 'chat_session' AND c.scope_id <> $4 AND EXISTS (
                  SELECT 1 FROM chat_threads o WHERE o.org_id = c.org_id AND o.id = c.scope_id AND o.project_id IS NULL AND o.created_by = $2)))`,
      [org, t.user_id, t.created_at, t.id],
    );
    const background: BackgroundClaim[] = bg.rows.map((r) => ({ id: r.id, kind: r.claim_kind ?? "fact", statement: r.statement }));
    samples.push({ threadId: t.id, userId: t.user_id, firstMessage: t.first_message, background });
  }
  const report = northStar(samples);
  const ev = await client.query<{ event: string; n: string }>(
    "SELECT event, count(*) AS n FROM kg_briefing_events WHERE org_id = $1 AND created_at >= $2 GROUP BY event", [org, since]);
  const count = (e: string) => Number(ev.rows.find((r) => r.event === e)?.n ?? 0);
  const briefing = { shown: count("shown"), accepted: count("accepted"), dismissed: count("dismissed") };
  const result = {
    org, since, ...report,
    briefing: { ...briefing, acceptRate: briefing.shown === 0 ? null : briefing.accepted / briefing.shown },
  };
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (out !== null) writeFileSync(out, text);
  process.stdout.write(text);
} finally {
  await client.end();
}
