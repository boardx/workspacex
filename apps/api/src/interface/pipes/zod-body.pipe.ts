/**
 * Contract validation -- one of the three mandatory runtime gates in `architecture.md`.
 *
 * The schema may only come from `@repo/contracts` (ADR-020, contract as single source).
 * A second DTO definition on the backend is this project's highest-risk surface for
 * "the same fact declared in two places": backend DTOs are shaped like the contract and
 * get copied by hand, after which both sides are internally consistent and nobody notices
 * until integration. It has already happened twice: `"org"|"team"` vs
 * `"org-wide"|"team-only"`, and `IngestionRun.status` vs `.state`.
 *
 * This pipe defines no structure at all. It executes the contract's schema and converts
 * zod issues into FIELD-LEVEL output. A blanket 400 is equivalent to having no validation
 * layer: the caller cannot tell which field to fix.
 */
import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

export interface FieldIssue {
  readonly path: string;
  readonly code: string;
}

export class ContractValidationError extends BadRequestException {
  constructor(readonly fields: readonly FieldIssue[]) {
    super("validation_failed");
  }
}

@Injectable()
export class ZodBodyPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  /** Lets gates assert that this really is the contract's schema -- compared by reference identity */
  get contractSchema(): T {
    return this.schema;
  }

  transform(value: unknown): unknown {
    const r = this.schema.safeParse(value);
    if (r.success) return r.data;
    throw new ContractValidationError(
      r.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", code: i.code })),
    );
  }
}
