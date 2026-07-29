// Counter-proof fixture: right layer, wrong return.
//
// It IS in infrastructure/, which is where tenant reads belong -- so a gate that only
// checked the folder would pass this. It returns raw rows, so nothing downstream is forced
// to obtain a decision before showing them.
export async function listSegments(q: { query(sql: string, p: unknown[]): Promise<{ rows: unknown[] }> }, org: string) {
  const r = await q.query("SELECT * FROM org_memberships WHERE org_id = $1", [org]);
  return r.rows;
}
