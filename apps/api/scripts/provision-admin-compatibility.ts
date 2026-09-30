import { existsSync } from "node:fs";
import { Client } from "pg";
import { appConfig } from "../src/infrastructure/db/pg-config";
import { initialBootstrapResult, probeBootstrapCompatibility, type BootstrapProbeInput } from "../src/infrastructure/deploy/bootstrap-compatibility";
// Loading these side-effect-free modules proves the actual bootstrap dependency closure.
import { ensureProvisionAdmin } from "../src/application/deploy/ensure-provision-admin";
import { PgRegistrationRepository } from "../src/infrastructure/auth/pg-registration-repository";
import { PgCredentialRepository } from "../src/infrastructure/auth/pg-credential-repository";
import { PgIdentityRepository } from "../src/infrastructure/identity/pg-identity-repository";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
void [ensureProvisionAdmin, PgRegistrationRepository, PgCredentialRepository, PgIdentityRepository, BcryptPasswordHasher, PgDatabase];

const input: BootstrapProbeInput = {
  sourceSha: process.env.CN_BOOTSTRAP_SOURCE_SHA ?? "",
  phase: process.env.CN_BOOTSTRAP_PHASE as BootstrapProbeInput["phase"],
  imageDigest: process.env.CN_BOOTSTRAP_IMAGE_DIGEST,
  email: process.env.PROVISION_ADMIN_EMAIL ?? "", password: process.env.PROVISION_ADMIN_PASSWORD ?? "",
  displayName: process.env.PROVISION_ADMIN_NAME ?? "", orgName: process.env.PROVISION_ORG_NAME ?? "",
};
let result = initialBootstrapResult(input);
let client: Client | undefined;
try {
  if (!existsSync(new URL("./provision-admin.ts", import.meta.url))) {
    result.checks[input.phase === "prebuild" ? "sourceEntrypoint" : "imageEntrypoint"] = false;
    throw new Error("BOOTSTRAP_IMAGE_INCOMPATIBLE");
  }
  if (!["starter", "production"].includes(process.env.WORKSPACEX_DEPLOY_PROFILE ?? "")) throw new Error("BOOTSTRAP_INPUT_INVALID");
  const config = appConfig(); // Validates production transport/TLS using the canonical mapping.
  if (process.argv.includes("--static")) {
    result.ready = result.blockers.length === 0;
  } else if (result.blockers.length === 0) {
    client = new Client({ ...config, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    await client.connect();
    result = await probeBootstrapCompatibility(client, input);
  }
} catch (error) {
  const code = error instanceof Error && ["BOOTSTRAP_IMAGE_INCOMPATIBLE", "BOOTSTRAP_INPUT_INVALID"].includes(error.message)
    ? error.message : "BOOTSTRAP_COMPATIBILITY_UNKNOWN";
  result.ready = false; result.blockers.push(code);
} finally {
  if (client) try { await client.end(); } catch {
    result.ready = false; result.blockers.push("BOOTSTRAP_PROBE_CLEANUP_UNPROVEN");
  }
}
console.log(`CN_BOOTSTRAP_COMPAT_JSON=${JSON.stringify(result)}`);
if (!result.ready) process.exitCode = 1;
