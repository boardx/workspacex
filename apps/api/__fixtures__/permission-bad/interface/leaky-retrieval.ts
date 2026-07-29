// Counter-proof fixture: the realistic shape of an R7 bypass.
//
// Nothing here is malicious and nothing here is tenant-INcorrect -- org_id is filtered, so
// RLS is satisfied and every test anyone writes about it passes. It is permission-blind:
// a team-only artifact's segments go straight to a caller in another team.
export async function search(q: { query(sql: string, p: unknown[]): Promise<{ rows: unknown[] }> }, org: string) {
  const r = await q.query("SELECT * FROM acl_bindings WHERE org_id = $1", [org]);
  return r.rows;
}

export async function browse(q: { query(sql: string, p: unknown[]): Promise<{ rows: unknown[] }> }, org: string) {
  const r = await q.query("SELECT p.name FROM projects p JOIN groups g ON g.project_id = p.id WHERE p.org_id = $1", [org]);
  return r.rows;
}
