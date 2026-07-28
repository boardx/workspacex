/**
 * Kernel probe routes -- the SURFACE UNDER TEST for the runtime gates, not business routes.
 *
 * Same nature as the `rls_probe` table: a kernel asset, not scaffolding. Delete it and the
 * three runtime gates lose the thing they assert against -- "is the guard globally
 * registered / does a validation layer exist / does the error boundary leak" would fall
 * back to a human reading the code.
 *
 * There is NO business logic here. `acl_bindings` and the two-layer intersection belong to
 * F01; this file only proves the three pipelines are actually mounted.
 */
import { Body, Controller, Get, Inject, Post, UsePipes } from "@nestjs/common";
import { identity } from "@repo/contracts";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { assertPrincipal, type Principal } from "../../domain/principal";
import { CurrentPrincipal } from "../current-principal.decorator";
import { ZodBodyPipe } from "../pipes/zod-body.pipe";

/**
 * The validation schema is taken STRAIGHT FROM THE CONTRACT; no structure is redefined here.
 * `lint-contract-source` blocks any attempt to write a second copy on the backend, and
 * `contract-single-source.test.ts` additionally asserts this is the same object reference.
 */
export const PROBE_BODY_SCHEMA = identity.operations.authorize.in;

/** A deliberately recognisable secret. The error-boundary assertion keys off it: if it
 *  shows up in a response body, that is a leak. */
export const SENSITIVE_CANARY = "KERNEL-SENSITIVE-CANARY-acl_bindings";

@Controller("/kernel/probe")
export class KernelProbeController {
  constructor(@Inject(DATABASE_PORT) private readonly db: DatabasePort) {}

  /** Positive assertion surface for the Guard: reaching here means the principal is non-null */
  @Get("/whoami")
  whoami(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    return { userId: principal.userId, orgId: principal.orgId };
  }

  /** Surface under test for validation: body checked by the CONTRACT's zod, 400 + fields on failure */
  @Post("/validate")
  @UsePipes(new ZodBodyPipe(PROBE_BODY_SCHEMA))
  validate(@Body() body: unknown) {
    return { ok: true, keys: Object.keys(body as object).sort() };
  }

  /** Surface under test for the error boundary: throw carrying the canary, assert it never surfaces */
  @Get("/boom")
  boom(): never {
    throw new Error(`SELECT * FROM acl_bindings WHERE token = '${SENSITIVE_CANARY}'`);
  }

  /** Positive surface for tenant context: read the probe table, should only see own org's rows */
  @Get("/tenant-rows")
  async tenantRows(@CurrentPrincipal() principal: Principal) {
    assertPrincipal(principal);
    const rows = await this.db.withTenant(principal.orgId, async (s) => {
      const r = await s.query<{ payload: string }>("SELECT payload FROM rls_probe ORDER BY payload");
      return r.rows.map((x) => x.payload);
    });
    return { orgId: principal.orgId, rows };
  }
}
