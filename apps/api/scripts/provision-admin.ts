import { auth } from "@repo/contracts";
import { ensureProvisionAdmin } from "../src/application/deploy/ensure-provision-admin";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { appConfig } from "../src/infrastructure/db/pg-config";
import { PgRegistrationRepository } from "../src/infrastructure/auth/pg-registration-repository";
import { PgCredentialRepository } from "../src/infrastructure/auth/pg-credential-repository";
import { PgIdentityRepository } from "../src/infrastructure/identity/pg-identity-repository";
import { BcryptPasswordHasher } from "../src/infrastructure/auth/bcrypt-password-hasher";
import { ensureDefaultAgent } from "../src/application/agent/ensure-default-agent";
import { ensureDeepResearchAgent } from "../src/application/agent/ensure-deep-research-agent";
import { ensureImageGenAgent } from "../src/application/agent/ensure-image-gen-agent";
import { PgDefaultAgentRepository } from "../src/infrastructure/agent/pg-default-agent-repository";
import { PgDeepResearchAgentRepository } from "../src/infrastructure/agent/pg-deep-research-agent-repository";
import { PgImageGenAgentRepository } from "../src/infrastructure/agent/pg-image-gen-agent-repository";
import { toOrgId } from "../src/domain/org-id";

let db: PgDatabase | undefined;
try {
  const input = auth.operations.bootstrapFirstUser.in.parse({ email: process.env.PROVISION_ADMIN_EMAIL,
    password: process.env.PROVISION_ADMIN_PASSWORD, displayName: process.env.PROVISION_ADMIN_NAME,
    orgName: process.env.PROVISION_ORG_NAME });
  db = new PgDatabase(appConfig());
  const database = db;
  const result = await ensureProvisionAdmin({ repo: new PgRegistrationRepository(db),
    credentials: new PgCredentialRepository(db), identity: new PgIdentityRepository(db), hasher: new BcryptPasswordHasher(),
    async seedAgents(ids) {
      const input = { orgId: toOrgId(ids.orgId), actorId: ids.userId };
      const defaultAgent = await ensureDefaultAgent({ repo: new PgDefaultAgentRepository(database) }, input);
      await ensureDeepResearchAgent({ repo: new PgDeepResearchAgentRepository(database) }, input);
      await ensureImageGenAgent({ repo: new PgImageGenAgentRepository(database) }, input);
      return { defaultAgentId: defaultAgent.agentId };
    },
  }, input);
  console.log(JSON.stringify({ ok: true, ...result }));
} catch {
  console.error(JSON.stringify({ ok: false, reason: "provision_admin_failed" }));
  process.exitCode = 1;
} finally { await db?.close(); }
