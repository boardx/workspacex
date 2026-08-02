/**
 * F42 / R12 V5 ③ — "把请求中的 evidencePolicy 篡改为客户端伪造值时，服务端仍按最严策略执行"
 * (server-side enforcement, never trust the client).
 *
 * `QueryContext.evidencePolicy` (`packages/contracts/src/context-pack.ts`) is a signed
 * `z.enum(["primary-only", "reviewed", "all"])`. NestJS's global ValidationPipe rejects a
 * genuinely malformed body before a handler ever runs — but a value that is syntactically a
 * string the schema accepts, produced by a client that does not use the generated types (a
 * hand-rolled HTTP call, a replayed/edited request, a future caller), reaches application code
 * as `unknown`, not as the branded enum. Trusting `input.evidencePolicy as EvidencePolicy`
 * at that boundary is exactly the "视觉标记" failure mode R7 names: the type assertion
 * compiles, and a forged value that happens to collide with `"all"` sails through with the
 * loosest reading, silently.
 *
 * `coerceEvidencePolicy` is the one place that boundary is crossed. It parses against the
 * SAME contract enum (no second vocabulary to drift from `context-pack.ts`), and on anything
 * that does not parse — not just "not one of the three strings", but also `null`/`undefined`/
 * an object/a case-mismatched string — it fails closed to `"primary-only"`, the strictest
 * reading available. That is the load-bearing decision: a validation failure here does not
 * throw and does not default to "reviewed" or "all" (either of which would let a malformed
 * request see MORE than a well-formed one asking for the loosest policy would), it defaults to
 * seeing less.
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";

export type EvidencePolicy = z.infer<typeof CP.EvidencePolicy>;

/** The fail-closed default — see header. Exported so tests can assert against it by name. */
export const STRICTEST_EVIDENCE_POLICY: EvidencePolicy = "primary-only";

export function coerceEvidencePolicy(raw: unknown): EvidencePolicy {
  const parsed = CP.EvidencePolicy.safeParse(raw);
  return parsed.success ? parsed.data : STRICTEST_EVIDENCE_POLICY;
}
