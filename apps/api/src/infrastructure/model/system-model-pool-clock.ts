/**
 * `ModelPoolClock` -- the two non-deterministic values `registerModel` needs.
 *
 * Separated from the use case so a test can fix both (`ports.ts`: 「injected so the use case
 * stays deterministic under test」). `sealedAt` in particular ends up in a `model_secrets`
 * row, and a test that cannot fix it cannot assert on the record it produced.
 */
import { randomUUID } from "node:crypto";
import type { ModelPoolClock } from "../../application/model/ports";

export class SystemModelPoolClock implements ModelPoolClock {
  /** ISO 8601 -- what `SealedCredential.sealedAt` is declared to be. */
  now(): string {
    return new Date().toISOString();
  }

  /**
   * ⚠ Prefixed. A bare UUID in a log line is unattributable; `mdl-` makes a model id
   * recognisable in the one place -- provenance -- where ids from six tables sit together.
   */
  newModelId(): string {
    return `mdl-${randomUUID()}`;
  }
}
