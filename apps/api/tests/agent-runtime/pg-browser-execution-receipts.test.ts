import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { BrowserContext, BrowserInvocationOutput } from '../../src/application/agent-run/standard-browser-tools';
import type { DatabasePort, QueryResult, TenantSession } from '../../src/application/ports/database.port';
import { PgBrowserExecutionReceipts } from '../../src/infrastructure/agent-run/pg-browser-execution-receipts';

interface Row {
  tool_name: string;
  args_digest: string;
  status: 'pending' | 'succeeded' | 'unconfirmed';
  result: unknown;
}

function database() {
  const rows = new Map<string, Row>();
  const session: TenantSession = {
    async query<R>(sql: string, params: readonly unknown[] = []): Promise<QueryResult<R>> {
      const key = `${params[0]}:${params[1]}:${params[2]}`;
      if (sql.includes('kernel_claim_browser_execution')) {
        const prior = rows.get(key);
        if (prior) {
          if (prior.tool_name !== params[3] || prior.args_digest !== params[4]) throw new Error('browser receipt conflict');
          return { rows: [{ disposition: prior.status === 'succeeded' ? 'succeeded' : 'unconfirmed', result: prior.result }] as R[] };
        }
        rows.set(key, { tool_name: String(params[3]), args_digest: String(params[4]), status: 'pending', result: null });
        return { rows: [{ disposition: 'claimed', result: null }] as R[] };
      }
      const row = rows.get(key);
      if (sql.includes('kernel_finish_browser_execution')) {
        if (!row || row.status !== 'pending' || row.tool_name !== params[3] || row.args_digest !== params[4]) return { rows: [{ saved: false }] as R[] };
        row.status = 'succeeded'; row.result = JSON.parse(String(params[7]));
        return { rows: [{ saved: true }] as R[] };
      }
      if (sql.includes('kernel_mark_browser_execution_unconfirmed')) {
        if (row?.status === 'pending' && row.tool_name === params[3] && row.args_digest === params[4]) row.status = 'unconfirmed';
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const db = {
    async withTenant<T>(_org: never, fn: (value: TenantSession) => Promise<T>) { return fn(session); },
    async withoutTenant<T>(fn: (value: TenantSession) => Promise<T>) { return fn(session); },
    async close() {},
  } as DatabasePort;
  return { db, rows };
}

const context = (toolCallId: string): BrowserContext => ({
  orgId: 'org' as never,
  parentRunId: 'run-a',
  attemptId: 'run-a:0',
  leaseEpoch: 1,
  bindingId: '00000000-0000-4000-8000-000000000001',
  toolCallId,
});
const invocation = { toolName: 'browser_navigate', toolArgs: { url: 'https://example.com/' } } as const;
const result: BrowserInvocationOutput = { pageRef: `page:${'a'.repeat(64)}`, url: 'https://example.com/', title: 'Example', generation: 1 };

describe('Pg browser execution receipts', () => {
  const deadline = () => new Date(Date.now() + 30_000);
  it('replays only a matching durable success across store instances', async () => {
    const { db } = database();
    const first = new PgBrowserExecutionReceipts(db);
    expect(await first.claim(context('call-ok'), invocation, 'digest-a', deadline())).toEqual({ kind: 'claimed' });
    await first.succeed(context('call-ok'), invocation, 'digest-a', result);
    const afterRestart = new PgBrowserExecutionReceipts(db);
    expect(await afterRestart.claim(context('call-ok'), invocation, 'digest-a', deadline())).toEqual({ kind: 'succeeded', result });
    await expect(afterRestart.claim(context('call-ok'), invocation, 'digest-b', deadline())).rejects.toThrow('receipt conflict');
  });

  it('keeps pending or unconfirmed outcomes non-replayable', async () => {
    const { db } = database();
    const receipts = new PgBrowserExecutionReceipts(db);
    expect(await receipts.claim(context('call-unknown'), invocation, 'digest-a', deadline())).toEqual({ kind: 'claimed' });
    expect(await new PgBrowserExecutionReceipts(db).claim(context('call-unknown'), invocation, 'digest-a', deadline())).toEqual({ kind: 'unconfirmed' });
    await receipts.markUnconfirmed(context('call-unknown'), invocation, 'digest-a');
    expect(await receipts.claim(context('call-unknown'), invocation, 'digest-a', deadline())).toEqual({ kind: 'unconfirmed' });
  });

  it('locks the running leased run and exposes only narrow browser receipt functions', () => {
    const sql = readFileSync(new URL('../../migrations/20260909124500_w10_browser_receipt_postcheck.sql', import.meta.url), 'utf8');
    expect(sql).toContain("r.status='running'");
    expect(sql).toContain('r.cancel_requested_at IS NULL');
    expect(sql).toContain('r.lease_epoch=p_epoch');
    expect(sql).toContain('deadline_at>clock_timestamp()');
    expect(sql).toContain('attempt_id=p_attempt');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.kernel_finish_browser_execution(text,text,text,text,text,jsonb)');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("prior.status='succeeded'");
    expect(sql).toContain("ELSE 'unconfirmed'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.kernel_claim_browser_execution');
    expect(sql).toContain("p_tool NOT IN ('browser_navigate','browser_snapshot','browser_click','browser_fill_form','browser_take_screenshot')");
  });
});
