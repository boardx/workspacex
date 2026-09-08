#!/usr/bin/env tsx
/**
 * `pnpm --filter @repo/api debug:trace` —— 不经 HTTP、不需要登录，用 `app_diag_ro` 凭据
 * 直接读 `debug_events`（issue #3082）。给会话里的 agent 用：在部署机或本地都能跑。
 *
 *   pnpm --filter @repo/api debug:trace --trace-id <id>            # 一条链路全部事件
 *   pnpm --filter @repo/api debug:trace --level error --limit 50   # 最近 50 条错误
 *   pnpm --filter @repo/api debug:trace --kind http.request.stalled --since 2026-09-08T00:00:00Z
 *   pnpm --filter @repo/api debug:trace --q "POST /threads" --json
 *
 * 连接参数同 `diagnosticsReaderConfig()`：PGHOST / PGPORT / PGDATABASE / DIAG_DB_USER /
 * DIAG_DB_PASSWORD。HTTP 同款接口见 `GET /system/debug/events`（平台运营准入）。
 */
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { diagnosticsReaderConfig } from "../src/infrastructure/db/pg-config";
import { PgDebugEventStore } from "../src/infrastructure/diagnostics/pg-debug-event-store";
import type { DebugEventLevel, DebugEventRow } from "../src/application/ports/debug-trace.port";

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function line(e: DebugEventRow): string {
  const dur = e.durationMs === null ? "" : ` ${e.durationMs}ms`;
  const who = e.userId ? ` user=${e.userId}` : "";
  return `${e.createdAt} ${e.level.padEnd(5)} ${e.kind.padEnd(24)} ${e.traceId.slice(0, 8)} ${e.msg}${dur}${who}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage: debug:trace [--trace-id ID] [--kind K] [--level info|warn|error] [--since ISO] [--until ISO] [--q TEXT] [--user USER] [--limit N] [--json]\n");
    return;
  }
  const readDb = new PgDatabase(diagnosticsReaderConfig());
  // 只读脚本：写池不需要——用同一个只读池占位，insertBatch 不会被调用。
  const store = new PgDebugEventStore(readDb, readDb);
  try {
    const traceId = str(args["trace-id"]) ?? str(args.trace);
    let items: readonly DebugEventRow[];
    if (traceId !== undefined) {
      items = await store.getTrace(traceId);
    } else {
      const level = str(args.level);
      const page = await store.query({
        kind: str(args.kind),
        level: level === "info" || level === "warn" || level === "error" ? (level as DebugEventLevel) : undefined,
        since: str(args.since),
        until: str(args.until),
        q: str(args.q),
        userId: str(args.user),
        limit: Math.min(500, Math.max(1, Number(str(args.limit) ?? 100) || 100)),
        beforeId: str(args.before) ?? null,
      });
      items = [...page.items].reverse();
    }
    if (args.json) {
      process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    } else {
      if (items.length === 0) process.stdout.write("(no events)\n");
      for (const e of items) {
        process.stdout.write(line(e) + "\n");
        if (args.data && e.data !== null) process.stdout.write("    " + JSON.stringify(e.data) + "\n");
      }
    }
  } finally {
    await readDb.close();
  }
}

main().catch((err) => {
  process.stderr.write(`debug:trace failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
