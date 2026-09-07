import {
  STANDARD_BROWSER_CONTRACTS,
  STANDARD_BROWSER_LIMITS,
} from '@repo/contracts/standard-browser-tools';
import type {
  BrowserContext,
  BrowserExecutionReceipts,
  BrowserInvocation,
  BrowserInvocationOutput,
  BrowserReceiptClaim,
} from '../../application/agent-run/standard-browser-tools';
import type { DatabasePort } from '../../application/ports/database.port';

interface ReceiptRow {
  readonly disposition: 'claimed' | 'succeeded' | 'unconfirmed';
  readonly result: unknown;
}

const browserTool = (name: string): name is keyof typeof STANDARD_BROWSER_CONTRACTS =>
  Object.hasOwn(STANDARD_BROWSER_CONTRACTS, name);

function parseResult(invocation: BrowserInvocation, value: unknown): BrowserInvocationOutput {
  if (!browserTool(invocation.toolName)) throw new Error('browser_receipt_invalid');
  return STANDARD_BROWSER_CONTRACTS[invocation.toolName].output.parse(value) as BrowserInvocationOutput;
}

/** Reuses the existing append/claim surface in mcp_tool_executions; no second receipt authority. */
export class PgBrowserExecutionReceipts implements BrowserExecutionReceipts {
  constructor(private readonly db: DatabasePort) {}

  async claim(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string): Promise<BrowserReceiptClaim> {
    return this.db.withTenant(context.orgId, async session => {
      const row = (await session.query<ReceiptRow>(
        'SELECT disposition,result FROM kernel_claim_browser_execution($1,$2,$3,$4,$5,$6,$7,$8)',
        [context.orgId, context.parentRunId, context.toolCallId, invocation.toolName, argsDigest,
          context.attemptId, context.leaseEpoch, new Date(Date.now() + STANDARD_BROWSER_LIMITS.deadlineMs + 5_000)],
      )).rows[0];
      if (!row) throw new Error('browser_receipt_unavailable');
      if (row.disposition === 'claimed') return { kind: 'claimed' };
      if (row.disposition === 'unconfirmed') return { kind: 'unconfirmed' };
      return { kind: 'succeeded', result: parseResult(invocation, row.result) };
    });
  }

  async succeed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string, result: BrowserInvocationOutput): Promise<void> {
    const saved = await this.db.withTenant(context.orgId, session => session.query<{ saved: boolean }>(
      'SELECT kernel_finish_browser_execution($1,$2,$3,$4,$5,$6::jsonb) AS saved',
      [context.orgId, context.parentRunId, context.toolCallId, invocation.toolName, argsDigest, JSON.stringify(result)],
    ));
    if (saved.rows[0]?.saved !== true) throw new Error('browser_execution_unconfirmed');
  }

  async markUnconfirmed(context: BrowserContext, invocation: BrowserInvocation, argsDigest: string): Promise<void> {
    await this.db.withTenant(context.orgId, session => session.query(
      'SELECT kernel_mark_browser_execution_unconfirmed($1,$2,$3,$4,$5)',
      [context.orgId, context.parentRunId, context.toolCallId, invocation.toolName, argsDigest],
    ));
  }
}
