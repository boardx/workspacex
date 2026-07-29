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
import { CapabilityController } from "./interface/controllers/capability.controller";
import {
  CAPABILITY_REPOSITORY,
  IN_FLIGHT_CALLS,
} from "./application/identity/capability-ports";
import { PgCapabilityRepository } from "./infrastructure/identity/pg-capability-repository";
import { InMemoryInFlightCalls } from "./infrastructure/identity/in-memory-in-flight-calls";
import { ProvenanceController } from "./interface/controllers/provenance.controller";
import { ArtifactBindingController } from "./interface/controllers/artifact-binding.controller";
import { ArtifactReferenceController } from "./interface/controllers/artifact-reference.controller";
import { ARTIFACT_REPOSITORY, ID_FACTORY } from "./application/artifact/ports";
import { BINDING_REPOSITORY } from "./application/artifact/binding-ports";
import { DOWNSTREAM_REFERENCE_REPOSITORY } from "./application/artifact/reference-ports";
import { PgArtifactRepository } from "./infrastructure/artifact/pg-artifact-repository";
import { PgBindingRepository } from "./infrastructure/artifact/pg-binding-repository";
import { PgDownstreamReferenceRepository } from "./infrastructure/artifact/pg-downstream-reference-repository";
import { UuidIdFactory } from "./infrastructure/artifact/uuid-id-factory";
import { CONTENT_REPOSITORY } from "./application/identity/content-ports";
import { PROVENANCE_READER, PROVENANCE_WRITER } from "./application/provenance/ports";
import { PgContentRepository } from "./infrastructure/content/pg-content-repository";
import { PgProvenanceRepository } from "./infrastructure/provenance/pg-provenance-repository";
import type { DatabasePort } from "./application/ports/database.port";

@Module({
  controllers: [
    HealthController,
    KernelProbeController,
    IdentityController,
    ProvenanceController,
    CapabilityController,
    ArtifactBindingController,
    ArtifactReferenceController,
  ],
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
    {
      provide: CONTENT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgContentRepository(db),
      inject: [DATABASE_PORT],
    },
    // One instance behind both tokens, on purpose: the writer and the reader are two
    // views of ONE table with ONE query surface (X-2). Two providers would be the first
    // step toward two implementations, and then toward two tables.
    {
      provide: PROVENANCE_WRITER,
      useFactory: (db: DatabasePort) => new PgProvenanceRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: PROVENANCE_READER,
      useExisting: PROVENANCE_WRITER,
    },
    {
      provide: CAPABILITY_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgCapabilityRepository(db),
      inject: [DATABASE_PORT],
    },
    // Process-local, and honestly so: nothing in phase-00 starts a model call, so every
    // count is really zero. The path exists end to end so 04-agent reports into it rather
    // than inventing a number for `affectedInFlightCalls` (see the port's note).
    { provide: IN_FLIGHT_CALLS, useClass: InMemoryInFlightCalls },
    // F06. `ObjectStore` is deliberately NOT provided: no route writes bytes, because the
    // two operations that would (`saveDraft`, `pinVersion`) still have no request shape
    // able to carry them (coherence D-2). A provider for a port nothing injects would
    // suggest otherwise.
    {
      provide: ARTIFACT_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgArtifactRepository(db),
      inject: [DATABASE_PORT],
    },
    {
      provide: BINDING_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgBindingRepository(db),
      inject: [DATABASE_PORT],
    },
    // F07. The single door every downstream citation passes through -- see 0010's header
    // and coverage gap ③: the five consumers live in other bundles, so the gate is a table
    // with a trigger rather than a check inside one use case.
    {
      provide: DOWNSTREAM_REFERENCE_REPOSITORY,
      useFactory: (db: DatabasePort) => new PgDownstreamReferenceRepository(db),
      inject: [DATABASE_PORT],
    },
    { provide: ID_FACTORY, useClass: UuidIdFactory },
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
