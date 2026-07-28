/**
 * Health / readiness endpoint. Operator-facing, not user-facing.
 *
 * Must not leak connection strings, role names or migration SQL (UC-0.6 R5). It returns
 * booleans and a migration filename: enough to answer "is RLS still forced?", not enough
 * to answer "where is your database?".
 *
 * `appRoleIsOwner` should always be false -- it is the runtime self-check for invariant
 * I-4, so that "someone pointed the connection at the owner" shows up in the health check
 * instead of waiting for a leak.
 */
import { Controller, Get, Inject } from "@nestjs/common";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { getKernelHealth } from "../../application/use-cases/get-kernel-health";
import { isKernelTrustworthy } from "../../domain/kernel-health";
import { Public } from "../public.decorator";
import { HEALTH_PROBE_FACTORY, type HealthProbeFactory } from "../ports.di";

@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: DatabasePort,
    @Inject(HEALTH_PROBE_FACTORY) private readonly probeOf: HealthProbeFactory,
  ) {}

  @Public()
  @Get("/healthz")
  async healthz() {
    const health = await getKernelHealth(this.probeOf(this.db));
    return { ...health, trustworthy: isKernelTrustworthy(health) };
  }
}
