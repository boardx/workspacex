/** Real SQL probe, always rolled back. Synthetic callers cannot authorize production. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

interface Client { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> }
const oldCreate = "INSERT INTO projects (id, org_id, name, status, kind) VALUES ($1, $2, $3, 'active', $4) RETURNING id, kind, status";
const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();
export function bindLegacyProjectSource(checkout: string, baselineSha: string) {
  if (!/^[a-f0-9]{40}$/.test(baselineSha)) throw new Error("INVALID_BASELINE_SOURCE");
  const read = (path: string) => execFileSync("git", ["-C", checkout, "show", `${baselineSha}:${path}`], { encoding: "utf8", timeout: 10_000 });
  const repository = read("apps/api/src/infrastructure/project/pg-project-repository.ts");
  const mapping = read("apps/api/src/domain/project/subtype-tables.ts");
  if (!normalize(repository).includes(oldCreate)
    || !repository.includes('cmd.kind === "research_project" ? "research_project_members" : "user_insight_members"')
    || !mapping.includes('research_project: "research_projects"') || !mapping.includes('user_insight: "user_insights"')) {
    throw new Error("LEGACY_PROJECT_SOURCE_CONTRACT_CHANGED");
  }
  return { baselineSha, repositorySha256: createHash("sha256").update(repository).digest("hex"),
    mappingSha256: createHash("sha256").update(mapping).digest("hex") };
}

export async function probeLegacyProjectSql(client: Client, orgId: string, id: string) {
  const reads: Record<string, boolean> = {}, writes: Record<string, boolean> = {};
  const readFailures: Record<string, string> = {}, writeFailures: Record<string, string> = {};
  const code = (error: unknown) => {
    const value = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (typeof value !== "string" || !/^[0-9A-Z]{5}$/.test(value)) throw new Error("PROJECT_PROBE_UNCLASSIFIED_ERROR");
    return value;
  };
  for (const [kind, table, members] of [
    ["research_project", "research_projects", "research_project_members"],
    ["user_insight", "user_insights", "user_insight_members"],
  ]) {
    await client.query("BEGIN");
    try {
      await client.query(`SELECT id,org_id FROM ${table} LIMIT 1`);
      await client.query(`SELECT user_id,project_id,org_id,role FROM ${members} LIMIT 1`);
      reads[kind!] = true;
    } catch (error) { reads[kind!] = false; readFailures[kind!] = code(error); }
    finally { await client.query("ROLLBACK"); }
    await client.query("BEGIN");
    try {
      const project = `${id}-${kind}`;
      await client.query(oldCreate, [project, orgId, "isolated compatibility probe", kind]);
      await client.query(`INSERT INTO ${table} (id, org_id) VALUES ($1, $2)`, [project, orgId]);
      await client.query(`INSERT INTO ${members} (user_id, project_id, org_id, role) VALUES ($1, $2, $3, 'owner')`, ["isolated-probe-user", project, orgId]);
      writes[kind!] = true;
    } catch (error) { writes[kind!] = false; writeFailures[kind!] = code(error); }
    finally { await client.query("ROLLBACK"); }
  }
  return { reads, writes, readFailures, writeFailures, allReads: Object.values(reads).every(Boolean), allWrites: Object.values(writes).every(Boolean),
    sqlExecuted: true, rollbackConfirmed: true, scope: "isolated-sql-contract" as const };
}
