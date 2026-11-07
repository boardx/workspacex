/** Test-only composition: real Nest/PG, explicitly injected localhost voice supplier.
 * Production src/main.ts never reads these test endpoints or selects a loopback.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { startApi } from "../src/main";
import { readRealtimeModelConfig } from "../src/interface/ws/realtime-digital-human.gateway";

const apiPort = Number(process.env.WORKSPACEX_API_PORT);
const supplierPort = Number(process.env.WORKSPACEX_ASR_PROVIDER_PORT);
for (const port of [apiPort, supplierPort]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("isolated fullstack ports are required");
}
const shared = readRealtimeModelConfig();
if (!shared.apiKey) throw new Error("fullstack shared model test credential is required");
// Provision only the existing metadata reader in this disposable fullstack database.
// Never run the enterprise acceptance app, financial seed or fault adapter here.
const isolationId = process.env.WORKSPACEX_ISOLATION_ID;
if (process.env.NODE_ENV === "production" || !isolationId?.trim()
  || !process.env.PGDATABASE?.startsWith("wsx_") || process.env.FULLSTACK_E2E_FIXTURE !== "1") {
  throw new Error("disposable fullstack catalog isolation required");
}
if (process.env.PLATFORM_ORG_CATALOG_DB_USER !== undefined || process.env.PLATFORM_ORG_CATALOG_DB_PASSWORD !== undefined) {
  throw new Error("unexpected preconfigured fullstack catalog credentials");
}
const { enterpriseAcceptance: catalogFixture } = await import("./lib/enterprise-acceptance-fixture");
// The canonical fixture username is constant; add a non-secret scope digest instead
// of sharing that LOGIN across isolation IDs. Reuse its canonical scoped password.
const catalogUser = `${catalogFixture.catalogUser}_${createHash("sha256").update(isolationId).digest("hex").slice(0, 16)}`;
const quotedUser = `"${catalogUser.replaceAll('"', '""')}"`;
const { asOwner } = await import("../tests/support/db");
await asOwner(async client => {
  await client.query("BEGIN");
  try {
    // A preexisting role is not proof of ownership, even if its name matches.
    // Fail closed; never ALTER/DROP credentials or adopt another run's authority.
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [catalogUser]);
    if (existing.rows.length) throw new Error("fullstack catalog LOGIN already exists; dispose the owned isolation stack");
    await client.query(readFileSync(new URL("../provisioning/platform-org-catalog.sql", import.meta.url), "utf8"));
    await client.query(`CREATE ROLE ${quotedUser} LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${catalogFixture.catalogPassword.replaceAll("'", "''")}'`);
    await client.query(`GRANT app_platform_org_catalog_ro TO ${quotedUser}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
});
Object.assign(process.env, {
  PLATFORM_ORG_CATALOG_DB_USER: catalogUser,
  PLATFORM_ORG_CATALOG_DB_PASSWORD: catalogFixture.catalogPassword,
});
await startApi({
  port: apiPort,
  listenHost: "127.0.0.1",
  loadLocalEnv: false,
  realtimeConfig: { ...shared, baseUrl: `ws://127.0.0.1:${supplierPort}/omni-realtime` },
});
process.stdout.write(`fullstack test API listening on ${apiPort}; voice supplier LOCAL_PROTOCOL\n`);
