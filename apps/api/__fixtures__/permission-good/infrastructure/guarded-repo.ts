// Reverse counter-proof: the CORRECT shape must pass.
//
// A gate that also rejects this is over-firing, which gets it muted, which is the same
// outcome as not having it. (Precedents in this repo: lint-omission-reason flagged 42
// free-text strings; lint-contract-source flagged 5 correct z.infer derivations.)
//
// Infrastructure layer, reads a tenant table, and hands back Guarded<T> -- the caller
// cannot reach a payload without application/security/permission-filter.disclose().
import { guard, type Guarded } from "../../../src/application/security/permission-filter";

export async function listProjects(
  q: { query(sql: string, p: unknown[]): Promise<{ rows: { id: string; name: string }[] }> },
  org: string,
): Promise<Guarded<{ name: string }>[]> {
  const r = await q.query("SELECT id, name FROM projects WHERE org_id = $1", [org]);
  return r.rows.map((row) => guard({ kind: "project", id: row.id }, { name: row.name }));
}
