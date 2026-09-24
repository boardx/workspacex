export const MIRO_CREDENTIAL_PATH = "src/infrastructure/whiteboard/pg-miro-credential-repository.ts";

const REQUIRED_TABLES = [
  "whiteboard_miro_oauth_states",
  "whiteboard_miro_credentials",
  "whiteboard_miro_audit",
];

/**
 * OAuth state and sealed credentials are authentication control-plane material, not an
 * acl_bindings content object. Admit this repository through executable invariants instead
 * of consuming another raw permission allowlist slot.
 */
export function checkMiroCredentialBoundary(source, migration, evidence) {
  const errors = [];
  if (source.includes("withoutTenant")) errors.push("must never bypass the tenant session");
  if (!source.includes("withTenant(p.orgId")) errors.push("every operation must enter the principal tenant session");
  for (const table of REQUIRED_TABLES) {
    if (!source.includes(table)) errors.push(`repository no longer binds expected table ${table}`);
    if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) errors.push(`migration no longer creates ${table}`);
    if (!migration.includes(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)) errors.push(`migration no longer forces RLS for ${table}`);
  }
  const sqlStatements = source.match(/`(?:INSERT INTO|SELECT|UPDATE)[\s\S]*?`/g) ?? [];
  if (sqlStatements.length < 6) errors.push("expected repository SQL statements are missing");
  for (const sql of sqlStatements) {
    if (!sql.includes("org_id=$1") && !sql.includes("org_id,actor_id")) {
      errors.push("every credential/state statement must bind org_id");
    }
    if (!sql.includes("actor_id") || (!sql.includes("actor_id=$2") && !sql.includes("org_id,actor_id"))) {
      errors.push("every credential/state statement must bind actor_id");
    }
  }
  if (!source.includes("consumed_at IS NULL") || !source.includes("expires_at>$4")) {
    errors.push("OAuth state consumption must stay one-time and expiring");
  }
  if (!source.includes("revision=$3") || !source.includes("revoked_at IS NULL")) {
    errors.push("credential rotation must retain CAS and active-record predicates");
  }
  if (/\b(?:access_token|refresh_token)\b/i.test(migration)) errors.push("migration must never persist plaintext token columns");
  if (!evidence.includes("Miro credential repository boundary")) errors.push("counterexample guard test is missing");
  return [...new Set(errors)];
}
