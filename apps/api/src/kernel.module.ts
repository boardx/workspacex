/**
 * Composition root -- deliberately NOT part of any layer.
 *
 * The onion rule is "dependencies point inward", but something has to wire ports to
 * implementations. That is the composition root. Importing both `infrastructure` and
 * `interface` here is legitimate, because this is not business code -- it is assembly
 * instructions.
 *
 * This is the only exemption from the layering rule, which is why it is EXPLICITLY
 * registered in the `COMPOSITION_ROOT` allowlist in `lint-arch-deps.mjs`, and that
 * allowlist holds exactly two files. Without registration, `src/` root would become a
 * backdoor around the layering check: "put the code in a directory with no layer name"
 * would evade the gate, and nothing would report it.
 */
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { DATABASE_PORT } from "./application/ports/database.port";
import { LOGGER_PORT } from "./application/ports/logger.port";
import { PRINCIPAL_RESOLVER_PORT } from "./application/ports/principal-resolver.port";

import { appConfig } from "./infrastructure/db/pg-config";
import { PgDatabase, pgHealthProbe } from "./infrastructure/db/pg-database";
import { ConsoleLogger } from "./infrastructure/logging/console-logger";
import { HeaderPrincipalResolver } from "./infrastructure/auth/header-principal-resolver";

import { AllExceptionsFilter } from "./interface/filters/all-exceptions.filter";
import { PrincipalGuard } from "./interface/guards/principal.guard";
import { HealthController } from "./interface/controllers/health.controller";
import { KernelProbeController } from "./interface/controllers/kernel-probe.controller";
import { HEALTH_PROBE_FACTORY } from "./interface/ports.di";

import {
  AUTHORIZATION_CACHE,
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  SESSION_STORE,
} from "./application/identity/ports";
import { PgIdentityRepository } from "./infrastructure/identity/pg-identity-repository";
import {
  InMemoryAuthorizationCache,
  InMemorySessionStore,
  UuidDecisionIdFactory,
} from "./infrastructure/identity/in-memory-session-store";
import { IdentityController } from "./interface/controllers/identity.controller";
import type { DatabasePort } from "./application/ports/database.port";

@Module({
  controllers: [HealthController, KernelProbeController, IdentityController],
  providers: [
    { provide: DATABASE_PORT, useFactory: () => new PgDatabase(appConfig()) },
    { provide: LOGGER_PORT, useFactory: () => new ConsoleLogger() },
    { provide: PRINCIPAL_RESOLVER_PORT, useClass: HeaderPrincipalResolver },
    { provide: HEALTH_PROBE_FACTORY, useValue: pgHealthProbe },
    {
      provide: IDENTITY_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgIdentityRepository(db),
      inject: [DATABASE_PORT],
    },
    // Process-local for now. Real session storage arrives with phase-01 01-auth, together
    // with the credential format this kernel deliberately did not decide (UC-0.6 A-3).
    { provide: SESSION_STORE, useClass: InMemorySessionStore },
    { provide: AUTHORIZATION_CACHE, useClass: InMemoryAuthorizationCache },
    { provide: DECISION_ID_FACTORY, useClass: UuidDecisionIdFactory },
    // Guard registered GLOBALLY. Per-route mounting means one missed route is a silent
    // authorization hole, and nothing would ever report it.
    { provide: APP_GUARD, useClass: PrincipalGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class KernelModule {}
