/**
 * PostgreSQL implementation of `DatabasePort`. Dependency inversion: this file imports
 * the application-layer port in order to implement it.
 *
 * Key constraint: the tenant context only lives inside a transaction. `SET LOCAL`
 * expires with the transaction and cannot leak to the next user of a pooled connection.
 * Using plain `SET` would cross tenants between requests, and the symptom would be
 * silently reading someone else's rows.
 */
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { currentRunLease, RunLeaseLostError } from "../../application/agent-run/run-lease";
import type { DatabasePort, QueryResult, TenantSession } from "../../application/ports/database.port";
import type { KernelHealthProbe } from "../../application/use-cases/get-kernel-health";
import type { OrgId } from "../../domain/org-id";
import type { PgConfig } from "./pg-config";

export class PgDatabase implements DatabasePort {
  private readonly pool: pg.Pool;
  private readonly activeSession = new AsyncLocalStorage<{orgId:OrgId|null;session:TenantSession}>();

  constructor(cfg: PgConfig) {
    this.pool = new pg.Pool({ ...cfg, max: 5 });
  }

  private async inTx<T>(orgId: OrgId | null, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    const nested=this.activeSession.getStore();
    if(nested){if(nested.orgId!==orgId)throw new RunLeaseLostError();return fn(nested.session);}
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (orgId !== null) {
        // Must be transaction-local. Parameterised set_config rather than string concatenation.
        await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      }
      const session: TenantSession = {
        async query<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
          const r = await client.query(sql, params as unknown[]);
          return { rows: r.rows as R[] } satisfies QueryResult<R>;
        },
      };
      const lease=currentRunLease();
      if(lease){
        if(orgId!==lease.orgId)throw new RunLeaseLostError();
        const ownership=await session.query(`SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2
          AND lease_epoch=$3 AND lease_expires_at>now() FOR UPDATE`,[orgId,lease.runId,lease.epoch]);
        if(!ownership.rows.length)throw new RunLeaseLostError();
      }
      const out = await this.activeSession.run({orgId,session},()=>fn(session));
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  withTenant<T>(orgId: OrgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inTx(orgId, fn);
  }

  withoutTenant<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.inTx(null, fn);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Health probe: all three queries read PG catalogs only, never business data. */
export function pgHealthProbe(db: DatabasePort): KernelHealthProbe {
  return {
    async migrationVersion() {
      return db.withoutTenant(async (s) => {
        const r = await s.query<{ name: string }>(
          "SELECT name FROM _kernel_migrations ORDER BY name DESC LIMIT 1",
        );
        return r.rows[0]?.name ?? null;
      });
    },
    async allRlsForced() {
      return db.withoutTenant(async (s) => {
        // Tables with RLS enabled but not FORCEd -- there should be exactly zero
        const r = await s.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind = 'r'
              AND c.relrowsecurity AND NOT c.relforcerowsecurity`,
        );
        return r.rows[0]?.n === "0";
      });
    },
    async currentRoleOwnsTables() {
      return db.withoutTenant(async (s) => {
        const r = await s.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_class c
             JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'public' AND c.relkind = 'r'
              AND pg_get_userbyid(c.relowner) = current_user`,
        );
        return r.rows[0]?.n !== "0";
      });
    },
  };
}
