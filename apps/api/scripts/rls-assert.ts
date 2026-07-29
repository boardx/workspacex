/**
 * Cross-tenant assertions 5-7 for verify-rls.sh.
 *
 * Connects as app_rw and issues a bare `SELECT * FROM rls_probe` -- no WHERE clause, no
 * application-level filtering of any kind. Whatever comes back is what RLS alone permits.
 */
import pg from "pg";
import { appConfig } from "../src/infrastructure/db/pg-config";

const cfg = appConfig();
const client = new pg.Client(cfg);
await client.connect();

let bad = 0;
const check = (label: string, expected: unknown, actual: unknown): void => {
  const okay = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`  ${okay ? "✓" : "✗"} ${label}${okay ? "" : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!okay) bad++;
};

async function rowsAs(org: string | null): Promise<string[]> {
  await client.query("BEGIN");
  try {
    if (org !== null) await client.query("SELECT set_config('app.current_org', $1, true)", [org]);
    // Deliberately unfiltered: this is the whole point of the counter-proof.
    const r = await client.query<{ org_id: string; payload: string }>("SELECT * FROM rls_probe ORDER BY payload");
    return r.rows.map((x) => `${x.org_id}/${x.payload}`);
  } finally {
    await client.query("COMMIT");
  }
}

const asA = await rowsAs("org-a");
check("5. as org-a, zero rows belong to org-b", [], asA.filter((r) => r.startsWith("org-b/")));
check("6. as org-b, own rows ARE visible (isolation, not paralysis)", ["org-b/b-row-1"], await rowsAs("org-b"));
check("7. with no tenant context, zero rows (fail-closed, not fail-open)", [], await rowsAs(null));

// A sanity guard on the fixture itself: if the seed were empty, assertion 5 would pass
// trivially. "Nothing leaked" is only meaningful when there was something to leak.
check("   (fixture sanity) org-a sees exactly its own two rows", ["org-a/a-row-1", "org-a/a-row-2"], asA);

await client.end();
if (bad === 0) console.log("RLS-ASSERT-OK");
process.exit(bad === 0 ? 0 : 1);
