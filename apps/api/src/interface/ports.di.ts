/**
 * Injection tokens needed by the `interface` layer.
 *
 * The health probe's IMPLEMENTATION lives in `infrastructure` (it reads PG catalogs), but
 * `interface` must not import `infrastructure` -- that would bind the controller to a
 * concrete implementation and make DI pointless. So this file declares only a factory
 * TYPE; the composition root injects the real thing.
 */
import type { DatabasePort } from "../application/ports/database.port";
import type { KernelHealthProbe } from "../application/use-cases/get-kernel-health";

export type HealthProbeFactory = (db: DatabasePort) => KernelHealthProbe;
export const HEALTH_PROBE_FACTORY = Symbol("HealthProbeFactory");
